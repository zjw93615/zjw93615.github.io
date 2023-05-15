---
title: 发布自己的npm包
tags:
  - npm
categories:
  - npm 
date: 2023-05-15 15:42:10
---

# 发布自己的npm包

我之前就已经做了一个前端日志上报的库，于是在五一期间就想着把这个库打包并放到npm上面以熟悉一下npm包的打包以及发布流程。

首先我们看看antd的包都包含些什么内容。从下图可以看出antd中主要包含了lib / es / dist三个文件夹，分别是通过三个不同的模块系统打包生成的。

- es：es module模块系统
- lib: CommonJS模块系统
- dist：UMD模块系统

下面我们来简单说说这三种打包方式以及为什么要这么打包。

{% asset_img img.png antd包 %}

## CommonJS

CommonJS规范是一种同步加载模块的方式，也就是说，只有当模块加载完成后，才能执行后面的操作。由于Nodejs主要用于服务器端编程，而模块文件一般都已经存在于本地硬盘，加载起来比较快，因此同步加载模块的CommonJS规范就比较适用。

- CommonJS模块是同步导入的，这就意味着它更适合用在服务器端，因为所有文件都在本地，即使同步加载速度也是非常快的。如果用在浏览器端，就会有问题了，部分js模块可能达到几M甚至十几M的大小。如果在前端采用CommonJS可能会导致浏览器阻塞，白屏无响应等情况。
- 你需要通过`require`来引用`node_modules`中的模块或者本地文件中的模块。
- 当你通过`require`引用CommonJS模块时，你得到的时一个浅拷贝的值

## UMD

UMD 既可以在前端也可以在后端使用，UMD 同时支持 CommonJS 和 AMD，也支持老式的全局变量规范。

- 可以在前端和后端通用
- UMD通常是其他打包软件，比如Rollup、webpack的候补选择。当CommonJS或者es module都不可用时将使用UMD进行导入。
- 支持直接在前端用 `<script src="lib.umd.js"></script>` 的方式加载

## es module(ESM)

与CommonJS规范动态加载不同，ESM模块化的设计思想是尽量的静态化，使得在编译时就能够确定模块之间的依赖关系。由于ESM尽可能地使用了静态化的方式进行引用，这使得它可以实现Tree Shaking来优化代码。
和CommonJS相同，ES6规范也定义了一个JS文件就是一个独立模块，模块内部的变量都是私有化的，其他模块无法访问。

- 通过 `import` 和 `export` 进行模块的引用和导出
- ESM的的引用是值的引用，因此如果你调用方法来修改模块内的值的时候，引用的值也会被修改
- ESM使用了静态化的方式进行引用，这使得它可以实现Tree Shaking来优化代码
- 现在已经逐渐被多种浏览器所支持，你可以如下面一样在html中引用ESM模块

```js
<script type="module">
  import {func1} from 'my-lib';
  func1();
</script>
```

到此为止，我弄明白了为什么需要这些文件以及这些文件分别有什么作用。接下来我们就可以开始使用打包工具进行打包了。

## UMD 打包
我们直接使用webpack进行打包，把 `libraryTarget: "umd"` 输出的目标文件设置为umd模块。
```js
module.exports = {
    entry: './src/index.ts',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
        ],
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
    },
    output: {
        path: distDir,
        filename: "[name].min.js",
        // 采用通用模块定义
        libraryTarget: "umd",
        library: 'easy-log-report'
    },
};
```

我们可以通过以下命令进行打包，或者 `"build": "webpack --config webpack.config.js"` 放在 `scripts` 中

```shell
npx webpack --config webpack.config.js
```

这个时候我们就可以看到dist文件夹中生成了一个main.min.js的文件，这个就是我们打包出来的UMD模块的文件了。

## CommonJS 打包

上面讲了如何使用 `webpack.config.umd.js` 的 `umd` 模式打包 `react` 组件，接下来我们讲如何使用 `commonjs` 模式打包 `react` 组件，`commonjs` 模式打包我们使用的是 `babel` 直接打包，并且要修改 `.babelrc`，如下：

```json
{
  "presets": ["@babel/preset-env", { "modules": "commonjs" }],
  "plugins": [
    "@babel/plugin-proposal-object-rest-spread",
    ["@babel/plugin-proposal-decorators", { "legacy": true }],
    "@babel/plugin-proposal-class-properties",
    "@babel/plugin-transform-classes"
  ]
}
```

## es module 打包

`es modules` 打包和 `babel` 打包很类似也是通过 `babel` 打包，不同的是 `.babelrc` 文件有所修改，代码如下：


```json
{
  "presets": ["@babel/preset-env", { "modules": false }],
  "plugins": [
    "@babel/plugin-proposal-object-rest-spread",
    ["@babel/plugin-proposal-decorators", { "legacy": true }],
    "@babel/plugin-proposal-class-properties",
    "@babel/plugin-transform-classes"
  ]
}
```

这样就完成了 UMD、CommonJS 和 es 的三种打包方式，但是这样有个问题：每次打包都要修改.babelrc 文件，能不能直接通过一条命令打包三种模式的方法呢？下面我们就来讲讲。

## 流程化打包

通过三种打包模式我们发现，.babelrc 文件跟三种模式打包有关，尤其是其中几个对象的设置，其它的设置都一样。我们可以通过修改 `.babelrc.js` 文件进行代码控制，同时我们也可以通过 `gulp` 来实现流程化打包。

gulp是基于node平台开发的前端构建工具，通过任务的方式执行机械化操作，提高开发效率。gulp能够帮我们完成几乎打包时候遇到的所有情况，html、css、js文件压缩合并，语法转换（es6、less...)，公共文件抽离，清理临时文件等。

```js
const gulp = require('gulp');
const babel = require('gulp-babel');
const clean = require('del');
const ts = require('gulp-typescript');
const merge = require('merge2');

const tsProject = ts.createProject('./tsconfig.json');
const ESDIR = './es';
const LIBDIR = './lib';

/* eslint-disable */
gulp.task('clean', () => {
  return clean(['lib']);
});

/* eslint-disable */
gulp.task('cleanEs', () => {
  return clean(['es']);
});

function moveLess(dir) {
  return gulp.src('./packages/**/*.less').pipe(gulp.dest(dir));
}

function compileTs() {
  return tsProject.src()
    .pipe(tsProject());
}

function babelConfig(moduleType) {
  return {
    babelrc: false,
    presets: [
      ["@babel/preset-env", { "modules": moduleType }]
    ],
    plugins: [
      "@babel/plugin-proposal-object-rest-spread",
      ["@babel/plugin-proposal-decorators", { "legacy": true }],
      "@babel/plugin-proposal-class-properties",
      "@babel/plugin-transform-classes"
    ]
  };
}

gulp.task('es', gulp.series('cleanEs', () => {
  const tsSream =  compileTs();
  const jsStream = tsSream.js.pipe(babel(babelConfig(false))).pipe(gulp.dest(ESDIR));
  const tsdStream = tsSream.dts
    .pipe(gulp.dest(ESDIR));
  return merge(jsStream, tsdStream);
}));

// 发布打包
gulp.task('lib', gulp.series('clean', () => {
  const tsSream =  compileTs();
  const jsStream = tsSream.js.pipe(babel(babelConfig('commonjs'))).pipe(gulp.dest(LIBDIR));
  const tsdStream = tsSream.dts
    .pipe(gulp.dest(LIBDIR));
  return merge(jsStream, tsdStream);
}));

gulp.task('default', gulp.series('lib', 'es'));
```

通过代码，我们可以看到，我们在这里新建了两个任务，分别对 `es` 和 `CommonJs` 进行打包，最后再把这两个task合并成为一个打包的 `series` 流程。至此我们就完成了同时打包三种模块的工作，再在 `package.json` 中进行一下 `scripts` 的整理。

```json
{
  "scripts": {
    "build": "webpack --config webpack.config.js",
    "lib": "gulp lib",
    "es": "gulp es",
    "pub": "gulp",
    "propub": "gulp && webpack --config webpack.config.js",
  }
}
```

我们在需要打包的时候，直接运行脚本 `propub` 即可完成打包。

```shell
npm run propub
```