---
title: Webpack 实现 Tree Shaking 详解
tags:
  - Webpack
  - TreeShaking
  - 性能优化
categories:
  - Webpack
date: 2025-12-06 21:18:21
---

### Webpack 实现 Tree Shaking 详解
Tree Shaking 是 Webpack 中用于**删除未被使用的代码（死代码）** 的优化手段，核心依赖 ES 模块（`import/export`）的静态分析特性（CommonJS 的 `require` 是动态加载，无法被 Tree Shaking）。以下是完整的配置步骤和注意事项：

---

## 一、核心前提：使用 ES 模块
Tree Shaking 仅对 ES 模块生效，因此需确保代码中：
- 用 `import/export` 导入/导出模块，而非 `require/module.exports`；
- 避免动态导入（如 `import(`${path}/file.js`)`，除非配合 Webpack 动态导入优化）。

---

## 二、基础配置（Webpack 5+ 为例）
### 1. 模式（mode）设置为 production
Webpack 的 `production` 模式会默认启用以下 Tree Shaking 相关优化：
- `optimization.usedExports: true`：标记未被使用的导出；
- `optimization.minimize: true`：通过 TerserPlugin 删除标记的死代码；
- 其他压缩、去重优化。

```javascript
// webpack.config.js
module.exports = {
  mode: 'production', // 关键：production 模式默认开启核心优化
  entry: './src/index.js',
  output: {
    filename: 'bundle.js',
    path: __dirname + '/dist'
  }
};
```

### 2. 手动配置 optimization（可选，用于自定义）
若需精细控制，可手动配置 `optimization`：
```javascript
// webpack.config.js
const TerserPlugin = require('terser-webpack-plugin'); // Webpack 5 内置，无需额外安装

module.exports = {
  mode: 'none', // 关闭默认模式，手动配置
  entry: './src/index.js',
  output: { /* 输出配置 */ },
  optimization: {
    // 步骤1：标记未使用的导出（Tree Shaking 标记阶段）
    usedExports: true,
    // 步骤2：删除标记的死代码（Tree Shaking 执行阶段）
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          compress: {
            unused: true // 强制删除未使用的代码（默认开启）
          }
        }
      })
    ]
  }
};
```

---

## 三、关键配置：package.json 的 sideEffects
`sideEffects` 用于告诉 Webpack **哪些文件有“副作用”**，Webpack 会跳过对有副作用文件的 Tree Shaking（避免误删关键代码）。

### 什么是“副作用”？
- 副作用：执行模块时，除了导出内容外，还会影响全局环境（如修改 `window` 变量、引入全局样式、执行 polyfill 等）；
- 无副作用：模块仅导出变量/函数，执行后无全局影响。

### 配置方式：
```json
// package.json
{
  // 方式1：所有文件无副作用（推荐，需确保代码无全局副作用）
  "sideEffects": false,
  // 方式2：指定有副作用的文件（数组形式）
  "sideEffects": [
    "./src/global.css", // 样式文件有副作用（引入即生效）
    "./src/polyfill.js" // 全局 polyfill 有副作用
  ]
}
```
⚠️ 注意：
- 若不配置 `sideEffects`，Webpack 会默认认为所有文件都有副作用，导致 Tree Shaking 失效；
- 样式文件（`.css/.less`）必须加入 `sideEffects`，否则会被 Tree Shaking 删掉。

---

## 四、Babel 配置：避免破坏 ES 模块
若项目使用 Babel（如 `@babel/preset-env`），需确保 Babel 不将 ES 模块转成 CommonJS（否则 Tree Shaking 失效）。

### 配置 `@babel/preset-env` 的 `modules` 选项：
```json
// .babelrc 或 babel.config.json
{
  "presets": [
    [
      "@babel/preset-env",
      {
        "modules": false, // 关键：禁用模块转换（保留 ES 模块）
        "targets": { "chrome": "60" } // 按需配置目标浏览器
      }
    ]
  ]
}
```
- `modules: false`：强制保留 ES 模块；
- 若设为 `auto`（默认），Babel 会根据环境自动判断：Webpack 打包时通常不会转，但需确认。

---

## 五、验证 Tree Shaking 生效
### 1. 编写测试代码
```javascript
// src/utils.js（导出未被使用的函数）
export const add = (a, b) => a + b;
export const minus = (a, b) => a - b; // 未被使用，应被 Tree Shaking

// src/index.js（仅导入 add）
import { add } from './utils.js';
console.log(add(1, 2));
```

### 2. 打包后检查
打包后查看 `dist/bundle.js`，应**不存在 `minus` 函数的代码**，说明 Tree Shaking 生效。

---

## 六、常见问题及解决方案
1. **Tree Shaking 不生效**：
   - 原因：使用了 CommonJS 模块、Babel 转了 ES 模块、未配置 `sideEffects`、代码有隐式副作用；
   - 解决：替换为 ES 模块、调整 Babel 配置、正确设置 `sideEffects`。
2. **样式文件被删掉**：
   - 原因：未将样式文件加入 `sideEffects`；
   - 解决：在 `package.json` 的 `sideEffects` 中包含 `.css/.less` 等样式文件。
3. **动态导入的代码未被优化**：
   - 解决：使用 Webpack 的 `import()` 动态导入，并配合 `webpackChunkName` 注释，Webpack 5 会对动态导入的模块单独 Tree Shaking。

---

