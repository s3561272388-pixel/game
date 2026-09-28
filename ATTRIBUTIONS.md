# 素材来源与鸣谢

鸣潮 / Wuthering Waves 的名称、角色、武器及声骸原作美术权利归 Kuro Games / 库洛游戏及相应权利人。此包用于非官方、非商业同人原型试用，未主张获得官方授权。

## 角色 2D 表情

来源：[呜哇小站 · 角色图鉴](https://emoji.wuwa.games/characters)。通过公开网页的正常图片展示获取，未改绘；界面进行缩放、平移和透明度动画。来源文章标示 CC BY-NC-SA 4.0，原角色权利不因文章许可而转移。

- 长离：[长离表情包1（静态）](https://emoji.wuwa.games/archives/changli-pack1-png)，画师九个西瓜，来源页注明由一个路过的特摄厨约稿。
- 炽霞：[炽霞动态表情包（雾雪猫猫版）](https://emoji.wuwa.games/archives/chixia-loading-error)，画师雾雪，具体作者字段见素材清单。
- 安可：[安可宝贝动态表情包（雾雪）](https://emoji.wuwa.games/archives/anke-wuxue-phase-1)，画师雾雪，具体作者字段见素材清单。
- 维里奈：[维里奈动态表情包（板鸭款）](https://emoji.wuwa.games/archives/weilina-banya-phase-4)，来源页画师字段为猫屋敷梨梨 & 春也 Haruya。

实际来源页署名以及每个本地文件的对应关系列于 `assets/manifest.json` 和 `assets/LICENSES.csv`；如页面标题与画师字段不同，以逐素材记录为准。

## 武器与声骸

[ryanbenson / wuthering-waves-assets](https://github.com/ryanbenson/wuthering-waves-assets)，原美术归库洛游戏。取自仓库 `images/weapons`、`images/echoes`；40 个原始下载地址均保存在素材清单中。未发现本任务范围内可据以主张商业美术授权的许可，不能将公开仓库视为商用许可。

## 程序与声音

- 用户提供的《背包大乱斗》策划、JSON 数值和参考工具链。
- React / React DOM：MIT。Lucide 图标：ISC。相应许可证随附于 `licenses/`。
- 界面、玩法状态管理与合成音效为本任务新增。环境提示音由 Web Audio 合成，不使用鸣潮原声录音。

项目未接入外部账号、联机服务或付费系统。


## 1.2 启动终端新增素材

- 独立长离立绘：[555me / Wuthering-Waves-GameAssets](https://github.com/555me/Wuthering-Waves-GameAssets)，原作美术归库洛游戏。文件 `T_IconRole_Pile_changli_UI.png`，原始尺寸 696×960，透明 PNG；未把表情包放大当作立绘。具体原始地址见 `assets/terminal/manifest.json`。
- 启动表情：复用前述已署名的五张表情，单独登记在 `assets/emoji/manifest.json`，用于 64px 气泡；原作者与来源页保留。总大小约 258 KiB，加载失败回退为文字。
- 终端徽标、频谱环、粒子与窗口图标为本项目程序绘制；交互声音由 Web Audio 合成，没有使用官方游戏音频。
- 新增依赖：Zod（MIT）、Electron（MIT，附 Chromium 第三方声明）；安装器使用 NSIS / electron-builder。生产依赖与其许可证随安装包保留。
- 按用户最终指定的 `s3561272388-pixel/Wuthering-Waves-Backpack-Brawl` 仓库交付。仓库公开不代表获得官方授权或商业使用许可；请保留素材来源、作者及原许可说明。
