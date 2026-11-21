# Wayfinder 界面设计规范

Wayfinder 每天帮你排计划、晚上对账。它不是监工：不打分、不催、没有连胜，不用刺眼的红色，文案短、像人说话。

2026-11-21 起的方向（「说一句话排今天」）：奶油底、暖橙圆角头卡、青绿圆形按钮、竖向时间轴上的彩色圆角块。简约、留白多、圆角大；不叠投影、不用渐变，今天页不再放黏土舞台和小人。本周、我、对账页里的黏土图片（`mobile/assets/images/clay/`，素材只许非商用，见同目录 `LICENSE-NOTE.md`）暂时还在。

## 令牌（`mobile/src/theme.ts`）

页面里不直接写颜色和数字，都从 `theme.ts` 拿：`useColors()` 给当前配色（白天跟随系统；21:00–6:00 或系统深色时用夜里那套，夜里是同色系的暗版）。

| 令牌 | 白天 | 用途 |
|---|---|---|
| `bg` / `surface` / `surface2` | `#FFF6EA` / `#FFFDF8` / `#F6EADB` | 奶油底 / 卡片 / 输入框 |
| `head` / `onHead` | `#F6B77C` / `#3A2A1E` | 今天页的暖橙头卡 / 上面的字（只用这一个色） |
| `primary` / `primaryEdge` / `onPrimary` | `#1F7A73` / `#155C56` / `#FFFFFF` | 青绿主按钮 / 底边和记号 / 按钮上的字 |
| `ink` / `ink2` | `#3A2A1E` / `#6B5444` | 深棕正文 / 次级字 |
| `tint` / `primaryInk` | `#DCEFEA` / `#17635D` | 选中、改动的浅青绿底 / 主色的字 |
| `kind` | 课 `#CFDDF8` 习惯 `#D7E6DA` 项目 `#FBD9B5` 可选 `#F9CFD3` 生活 `#F4ECE1` | 时间轴块的填充 |
| `kindEdge` | 同色系深一档 | 块的描边，也当这类事的记号（图标、进度条） |

对比度：文字 ≥ 4.5:1，非文字（块边界、记号、控件边界）≥ 3:1。每对的实测值写在 `theme.ts` 注释里，改色后要重新量。

- 间距 `space`：4 / 8 / 12 / 16 / 24 / 32。圆角 `radius`：`card` 20、`btn` 14、`in` 12、`pill`。
- 字：数字和英文 Nunito，中文系统字体；字号最小 13。
- 控件是平色块，厚度只有一道实色底边 `0 4px 0 <底边色>`（`c.clay`、`c.clayBtn`），按下时收掉。

## 今天（`app/(tabs)/index.tsx`）

1. 头卡：「今天」、日期、本周日期条（今天那格是卡片色的圆角块）；右上青绿圆按钮进 `/energy` 报电量。
2. 输入条：「说说今天要做什么」+ 话筒位（录音没做时是禁用的）+「排一下」（`sayDay`）。危机返回显示 `CrisisCard`，听不懂显示后端的 detail。没说过事项时给一句示例，点一下填进输入框。
3. 时间轴（`components/timeline.tsx`）：1 小时 = 64px，左边整点刻度，右边块高按分钟正比；块里粗体标题、下面时间；估出来的时长带「估」小标；生活块淡色；现在那一刻一条青绿线。每块是独立的 `TimelineBlock`，拖动和拉伸的手势加在它上面。
4. 主按钮固定在标签栏上方：没确认的计划是「用这个计划」（`confirmPlan`），19:00 以后或正事都做完是「对个账」，对过账就不放。

## 导师功能

`mobile/src/features.ts` 的 `MENTOR = false`：长谈、方向、给自己的信、季度回顾、对账后的长谈邀请、每周复盘的入口都藏起来；路由和代码保留，链接还能进。

## 组件和规则

页面只拼 `components/ui.tsx` 的件：`Screen`（`footer` 是固定主按钮）、`Card`、`Button`、`Chip`、`ListRow`、`Field`、`Notice`、`CrisisCard`、`ErrorState`、`Header`、文字件。动效和触感在 `components/motion.tsx`。

1. 可点区域至少 44pt；读屏用 `accessibilityLabel`，单选 `radio`、多选 `checkbox`。
2. 危机提示用平静的普通卡片，不用红色、不弹窗；红字只用于真的出错。
3. 读数据用骨架屏；没连上整页换 `ErrorState`，原始报错不给人看。
4. 「减少动态效果」打开时，常驻动效停掉，拖动松手直接落位。
5. 网页：内容最宽 560 居中。改动画值用 `.set()`；effect 里不同步 setState；render 里不 `new Date()`，现在的时间从 `useNow()` 拿。
