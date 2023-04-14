---
title: 使用patch-package修改第三方模块
tags:
  - npm
  - patch-package
categories:
  - npm
date: 2023-04-14 14:57:26
---

# 使用patch-package修改第三方模块

在我们日常开发中，经常会遇到一些情况就是引用的npm包并不能完全满足我们的需求，或者在某些情况下触发了bug使得组建的展示和行为不正常。这个时候，我们就需要去修改npm包的代码了。

但是，我们知道，我们不能直接进入`node_modules`中去修改包的代码。因为如果我们在本地的`node_modules`中修改了代码，可能在我们本地可以正常运行，但是如果团队的其他人员进行开发，甚至于使用`ci/cd`去部署项目时，由于它会重新下载新的包，这样你的改动就不能在其他机器上生效。

那么我们就来看看如何正确地修改npm包里面的内容，同时能够同步给其他开发人员，使得大家的npm包都是统一修改过的版本。

## 安装 patch-package
```shell
# npm
npm install patch-package --save-dev
```

## 修改并调试

一般我们可以直接在npm的官网找到对于的github地址，从而下载到源码。**需要注意的是，我们下载的源码必须要与我们项目中引用的版本相同**。我们就以`easy-log-report`这个包为例子，我们可以找到它的对应仓库在 [https://github.com/zjw93615/EasyLog](https://github.com/zjw93615/EasyLog) 。我们就把项目的文件下载到本地并且打开。 之后在根目录上按照依赖。

```shell
npm install
```

接着当我们修改完文件之后，我们怎么知道我们的修改是否生效呢？是否符合我们原来的预期呢？首先我们把修改好的项目`build`一下，不同的项目可能有不同的`build`方式，详细的可以看看项目的`package.json`或者`README.md`看是否有相关的说明。

```shell
npm run build
```

编译完成之后，我们可以通过`link`命令，把我们修改好的包本地链接到引入了这个包的项目中。

```shell
cd ~/projects/easy-log-report     # 需要修改的包的根目录
npm link                          # 创建全局的npm link

cd ~/projects/foo                 # 假设这个foo项目引用了easy-log-report这个包，去到foo的根目录
npm link easy-log-report          # 把easy-log-report这个包本地链接到foo这个项目
```

这样我们启动foo这个项目，我们就可以看到我们对于`easy-log-report`这个包的修改已经生效了。

## 创建补丁

在上面一步，我们已经把包修改完成并且完成调试了，这时候我们就可以把build好的文件拷贝到`node_modules`中对于的文件夹中。在这个例子中我们需要把~/projects/easy-log-report/build文件夹中的文件拷贝到~/projects/foo/node_modules/easy-log-report/build这个文件夹中。然后回到根目录执行patch-package。

```shell
# npm > 5.2
npx patch-package easy-log-report
```
执行完成后，会在项目根目录的 `patches`目录中创建补丁文件 **easy-log-report+1.0.3.patch（1.0.3 是依赖包版本）**，`这个补丁需要提交到代码仓库中`。

如果我们打开`.patch`文件，我们可以发现其实就是一些`git diff`记录描述，那么`patch-package`补丁原理呼之欲出——`patch-package`会将当前`node_modules`下的源码与原始源码进行`git diff`，并在项目根目录下生成一个`patch`补丁文件。

### options
--use-yarn
patch-package 默认是根据项目中的 lockfile 来决定使用 npm 还是 yarn，如果两种都有，则使用 npm，可以通过这个参数启用 yarn

--exclude <regexp>
创建补丁文件时，忽略与正则表达式匹配的路径，路径相对于要修改的依赖包的根目录，默认: package\\.json$

--include <regexp>
与 --exclude <regexp> 相反，创建补丁文件时仅考虑与正则表达式匹配的路径，默认: .*

--case-sensitive-path-filtering
使 --include 或 --exclude 中使用的正则表达式区分大小写

--patch-dir
指定放置补丁文件的目录

## 打补丁

当其他同事拉到代码如何应用补丁呢？基于上述操作我们在`npm install`后执行`patch-package`命令即可。
```shell
npx patch-package
```

### options
--reverse
撤回所有补丁
Note: 如果打补丁后，补丁文件被修改过，此操作将失败，此时可以重新安装 node_modules

--patch-dir
指定补丁文件所在目录

## 完善npm脚本
这个流程可借助`npm script`实现，在`package.json`的`script`中添加如下字段及内容：
```js
{
    "postinstall": "patch-package"
}
```

这样我们后续执行 npm install 或 yarn install 命令时，会自动为依赖包打补丁了

