# 长征纪念馆 · 万里见证

纪念伟大的长征。

这是一个可交互的中国工农红军长征纪念网页。以路线总览串联七个重点展章，在现代实测地形上阅读历史时间线、地点看点和档案线索。

## 展览内容

| 展章 | 场景与内容 |
| --- | --- |
| 湘江战役 | 界首一带的湘江河谷、渡口示意与桂北纪念记忆 |
| 遵义会议 | 遵义老城地形、会址建筑与二楼会议室剖切示意 |
| 四渡赤水 | 土城古渡所在的赤水河谷与分段时间线 |
| 巧渡金沙江 | 皎平渡河谷、木船示意与当地船工的故事 |
| 强渡大渡河 | 安顺场河谷、渡船示意及从渡口到桥梁的历史脉络 |
| 飞夺泸定桥 | 大渡河峡谷、铁索桥示意与当日电报线索 |
| 爬雪山过草地 | 可切换的夹金山与日干乔草地地形，以及行军文物 |

- 支持鼠标拖动、滚轮缩放、键盘控制和鸟瞰、地面、近景视角。选择历史时间节点可切换视角，雪山草地章的时间节点还可切换地形。
- 通过编号看点或下方的按钮阅读每章三条场景说明。二维地形保留全部时间线、看点与史料链接。缺少 WebGL 2 时自动进入二维模式。
- 四路路线总览支持按队伍和月份筛选，地图和地点列表均可进入对应展章。路线为代表性节点间的示意连线。

## 本地运行

需要 Node.js 20.19+（Node 20）或 22.12+（Node 22 及更新主版本），以及 npm。

```sh
npm ci
npm run dev
```

在浏览器打开终端显示的地址。运行以下命令可构建并预览发布版本。

```sh
npm run build
npm run preview
```

构建产物在 `dist/`，可部署到静态托管平台。Vite 使用相对资源路径，支持托管在子目录中。浏览时地形网格由同一站点提供，打开展章无需外部地图服务或 API 密钥。

## 数据、复原范围与署名

- **高程数据**使用 2000 年采集的 SRTM，数据由美国地质调查局提供，Mapzen 经 AWS Open Data 分发。八份区域网格均为 97×97 采样，由 z13 Terrarium 瓦片插值生成，单位为米。高程采集年份与分发来源见每份 JSON 的元数据。 [USGS SRTM](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-digital-elevation-shuttle-radar-topography-mission-srtm-1) · [Mapzen Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) · [数据署名](https://github.com/tilezen/joerd/blob/master/docs/attribution.md#srtm)
- **场景构件**包括建筑、河面、桥、船只和植被，均是为说明空间关系制作的示意模型。高程反映现代测量所见的区域地貌，场景几何和热点位置服务于展览阅读。皎平渡一带的高程采集早于乌东德水库蓄水。 [乌东德工程与皎平渡资料](https://wap.sasac.gov.cn/n2588025/n2588124/c36078420/content.html)
- **历史资料**在各章内列明出处。全程路线参考党史资料中的代表性地点和时间，地理位置采用近似点位。 [中央档案馆长征专题](https://www.saac.gov.cn/daj/yaow/202610/47471a679e6f4019ab4a0c7d2a1e02c8.shtml) · [中央党史和文献研究院长征专题](https://www.dswxyjy.org.cn/GB/427277/462086/index.html)

## 维护

| 路径 | 用途 |
| --- | --- |
| `src/chapters.js` | 展章、历史时间线、场景看点和资料链接 |
| `src/scene.js` | Three.js 地形、场景构件、摄影机与交互 |
| `src/relief.js` | 从同一份高程生成二维晕渲与等高线 |
| `src/routes.js` | 四路路线示意、月份筛选与地点索引 |
| `public/terrain/` | 预先生成的八份高程网格 |
| `scripts/generate-terrain.py` | 下载公开 Terrarium 高程瓦片并生成展区网格 |

站点构建直接使用仓库里的网格。需要重新取样时，联网执行以下命令。

```sh
python -m pip install Pillow
python scripts/generate-terrain.py
```
