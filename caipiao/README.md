# 多彩种彩票模拟器

基于 React、TypeScript 和 Vite 的纯本地彩票规则娱乐模拟器。

## 支持彩种

- 双色球复式
- 超级大乐透复式与追加
- 福彩3D、排列3：直选、组三、组六
- 排列5直选
- 七乐彩复式
- 快3历史玩法：和值、同号、不同号和连号玩法

快3等高频快开游戏已经退市，项目中的快3入口仅用于历史规则演示。

## 本地运行

```bash
npm install
npm run dev
```

Windows PowerShell 若禁用了脚本执行，可使用：

```powershell
npm.cmd run dev
```

## 验证

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

所有票据、隐藏开奖号、玩法和开奖状态均保存在浏览器 IndexedDB 中，不连接真实购彩平台。
