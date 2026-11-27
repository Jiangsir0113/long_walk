"""Crop the exhibit elevation grids or the regional route overview."""

import argparse
import json
import math
from functools import lru_cache
from pathlib import Path
import tempfile
from urllib.request import urlopen

from PIL import Image


GRID_SIDE = 97
TILE_SIDE = 256
ZOOM = 13
OVERVIEW_ZOOM = 5
METERS_PER_LATITUDE_DEGREE = 111_195
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium"
OVERVIEW_BOUNDS = {"west": 98.5, "south": 24.5, "east": 116.8, "north": 38.6}
SOURCE = {
    "name": "Mapzen Terrain Tiles / SRTM",
    "url": "https://registry.opendata.aws/terrain-tiles/",
    "attribution": "SRTM data courtesy of the U.S. Geological Survey; distributed by Mapzen via AWS Open Data.",
    "licenseUrl": "https://github.com/tilezen/joerd/blob/master/docs/attribution.md#srtm",
    "captureYear": 2000,
    "nativeResolutionArcSeconds": 1,
    "method": "Bilinear interpolation of zoom 13 Terrarium samples, rounded to whole meters.",
}
OVERVIEW_SOURCE = {
    "name": "Mapzen Terrain Tiles / GMTED2010 + ETOPO1",
    "url": "https://registry.opendata.aws/terrain-tiles/",
    "attribution": "GMTED2010 data courtesy of the U.S. Geological Survey; ETOPO1 bathymetry courtesy of NOAA; distributed by Mapzen via AWS Open Data.",
    "licenseUrl": "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
    "dataSourcesUrl": "https://github.com/tilezen/joerd/blob/master/docs/data-sources.md#what-is-sourced-at-what-zooms",
    "method": "Bilinear interpolation of zoom 5 Terrarium samples on a geographic grid, rounded to whole meters.",
}

# Each center is an approximate public landmark. The surrounding square provides
# regional context independently of the archival accounts shown in the exhibit.
EXHIBITS = {
    "xiangjiang": ("湘江界首镇", 110.7651, 25.7221, 5_000),
    "zunyi": ("遵义会议会址", 106.91612, 27.69154, 3_500),
    "chishui": ("赤水河土城古镇", 105.99306, 28.28377, 6_000),
    "jinsha": ("金沙江皎平渡", 102.3782, 26.2918, 5_000),
    "dadu": ("大渡河安顺场", 102.2845, 29.27515, 4_300),
    "luding": ("大渡河泸定桥", 102.23017, 29.9145, 2_600),
    "snow-grass": ("夹金山垭口", 102.6833, 30.862, 6_800),
    "snow-grass-alt": ("日干乔草地", 102.63911, 33.106, 11_000),
}


@lru_cache(maxsize=32)
def load_tile(cache, zoom, column, row):
    prefix = "" if zoom == ZOOM else f"{zoom}-"
    path = cache / f"{prefix}{column}-{row}.png"
    if not path.exists():
        partial = path.with_suffix(".part")
        with urlopen(f"{TILE_URL}/{zoom}/{column}/{row}.png", timeout=30) as response:
            partial.write_bytes(response.read())
        partial.replace(path)

    with Image.open(path) as raster:
        if raster.size != (TILE_SIDE, TILE_SIDE):
            raise ValueError(f"Unexpected pixel count in {path}")
        return raster.convert("RGB").tobytes()


def read_pixel(cache, zoom, x, y, touched_tiles):
    column, local_x = divmod(x, TILE_SIDE)
    row, local_y = divmod(y, TILE_SIDE)
    touched_tiles.add(f"{zoom}/{column}/{row}")
    raster = load_tile(cache, zoom, column, row)
    offset = (TILE_SIDE * local_y + local_x) * 3
    red, green, blue = raster[offset : offset + 3]
    return 256 * red + green + blue / 256 - 32_768


def read_elevation(cache, zoom, lon, lat, touched_tiles):
    # Terrarium pixels sample the centers of Web Mercator raster cells.
    world_pixels = TILE_SIDE * 2**zoom
    x = world_pixels * (lon + 180) / 360 - 0.5
    mercator_lat = math.asinh(math.tan(math.radians(lat)))
    y = world_pixels * (1 - mercator_lat / math.pi) / 2 - 0.5
    x0, y0 = math.floor(x), math.floor(y)
    fx, fy = x - x0, y - y0
    north = read_pixel(cache, zoom, x0, y0, touched_tiles) * (1 - fx)
    north += read_pixel(cache, zoom, x0 + 1, y0, touched_tiles) * fx
    south = read_pixel(cache, zoom, x0, y0 + 1, touched_tiles) * (1 - fx)
    south += read_pixel(cache, zoom, x0 + 1, y0 + 1, touched_tiles) * fx
    return round(north * (1 - fy) + south * fy)


def sample_grid(cache, bounds, zoom, source, **metadata):
    west, east = bounds["west"], bounds["east"]
    south, north = bounds["south"], bounds["north"]
    interval = GRID_SIDE - 1
    tiles = set()
    elevations = []
    for row in range(GRID_SIDE):
        sample_lat = north - (north - south) * row / interval
        for col in range(GRID_SIDE):
            sample_lon = west + (east - west) * col / interval
            elevations.append(read_elevation(cache, zoom, sample_lon, sample_lat, tiles))

    return {
        "width": GRID_SIDE,
        "height": GRID_SIDE,
        "bounds": bounds,
        **metadata,
        "units": "m",
        "order": "north-to-south, west-to-east",
        "source": {**source, "tiles": sorted(tiles)},
        "elevations": elevations,
    }


def crop_grid(cache, exhibit):
    name, lon, lat, size_meters = exhibit
    half_lat = size_meters / (2 * METERS_PER_LATITUDE_DEGREE)
    half_lon = half_lat / math.cos(math.radians(lat))
    bounds = {"west": lon - half_lon, "south": lat - half_lat, "east": lon + half_lon, "north": lat + half_lat}
    return sample_grid(
        cache, bounds, ZOOM, SOURCE,
        feature={"name": name, "lon": lon, "lat": lat},
        sizeMeters={"width": size_meters, "height": size_meters},
        spacingMeters=round(size_meters / (GRID_SIDE - 1), 1),
    )


def crop_overview(cache):
    bounds = OVERVIEW_BOUNDS
    mid_latitude = (bounds["south"] + bounds["north"]) / 2
    width_meters = (bounds["east"] - bounds["west"]) * METERS_PER_LATITUDE_DEGREE * math.cos(math.radians(mid_latitude))
    height_meters = (bounds["north"] - bounds["south"]) * METERS_PER_LATITUDE_DEGREE
    return sample_grid(
        cache, bounds, OVERVIEW_ZOOM, OVERVIEW_SOURCE,
        sizeMeters={"width": round(width_meters), "height": round(height_meters)},
        spacingMeters={"eastWest": round(width_meters / (GRID_SIDE - 1)), "northSouth": round(height_meters / (GRID_SIDE - 1))},
    )


def write_grid(path, grid):
    elevations = grid.pop("elevations")
    lines = [json.dumps(grid, ensure_ascii=False, indent=2).rsplit("\n}", 1)[0] + ',\n  "elevations": [']
    for start in range(0, len(elevations), GRID_SIDE):
        row = elevations[start : start + GRID_SIDE]
        lines.append("    " + ", ".join(map(str, row)))
    header, *rows = lines
    path.write_text(header + "\n" + ",\n".join(rows) + "\n  ]\n}\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=Path(tempfile.gettempdir()) / "longwalk-srtm-png")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "public/terrain")
    parser.add_argument("--overview", action="store_true", help="regenerate only the regional route overview")
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    args.output.mkdir(parents=True, exist_ok=True)

    grids = (
        (("overview", crop_overview(args.cache)),)
        if args.overview
        else ((key, crop_grid(args.cache, exhibit)) for key, exhibit in EXHIBITS.items())
    )
    for key, grid in grids:
        elevations = grid["elevations"]
        if max(elevations) <= min(elevations):
            raise ValueError(f"Elevation is flat for {key}")
        path = args.output / f"{key}.json"
        write_grid(path, grid)
        print(f"{path.name}: {min(elevations)}–{max(elevations)} m")


if __name__ == "__main__":
    main()
