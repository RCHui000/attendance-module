# PSA 黑白灰小人 Logo 动效计划

## Summary

- 不直接使用 `liquid-pause-animation` 原版紫蓝液态组件。
- 新增一个 PSA 定制 logo：黑白灰小人先出现，左右看一眼，然后向下消失，`PSA` 字样弹出。
- 播放时机：页面进入/刷新播放一次；鼠标悬停 logo 时可再次播放。
- 风格保持克制、工作台化，不做彩色、粒子、强发光或高频循环。

## Key Changes

- 新增 `PsaAnimatedLogo` 组件，替换 sidebar 顶部当前静态 `PSA` 方块。
- 动画使用纯 SVG + CSS keyframes，不新增 `motion` 依赖；外观沿用 PSA 当前圆角方块比例。
- 动画阶段固定为：
  - `0%~25%` 小人居中出现；
  - `25%~45%` 头部/视线向左；
  - `45%~65%` 头部/视线向右；
  - `65%~82%` 小人向下滑出并淡出；
  - `82%~100%` `PSA` 字样轻微上弹进入。
- 明暗模式：
  - 明亮/Sidebar 深底：深灰方块、浅灰人物、白色 `PSA`；
  - 深色：近黑方块、银灰人物、浅色 `PSA`。
- 可访问性：
  - `prefers-reduced-motion` 下禁用动画，直接显示静态 `PSA`。
  - logo 仍保持 `aria-label="PSA项目成本管理系统"`，不把动画内容暴露成噪音。

## Test Plan

- 进入/刷新页面后 logo 动画播放一次，结束停在 `PSA` 字样。
- 悬停 logo 后动画可重新播放，移开不抖动、不影响 sidebar 布局。
- 折叠 sidebar 下尺寸仍为图标方块，不撑宽侧边栏。
- 明亮/深色模式均可读，黑白灰对比清楚。
- 运行 `npm --prefix frontend run lint` 和 `npm --prefix frontend run build`。

## Assumptions

- 小人采用极简抽象形态：圆头、身体、左右视线/头部位移，不画复杂五官。
- 这次只改 PSA 品牌方块，不改导航图标体系。
- 不引入第三方动效库，除非后续明确要做更复杂的液态变形。
