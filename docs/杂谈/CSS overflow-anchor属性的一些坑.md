---
title: CSS overflow-anchor属性的一些坑
---

# CSS overflow-anchor属性的一些坑

之前在做虚拟滚动组件，但是在做虚拟滚动的时候却发现当你往上方填充空白区间的时候，scrollTop属性也跟着更新了，导致了计算时候的一些错误。后来发现是CSS overflow-anchor属性导致的问题。下面我来讲讲这个滚动锚定属性是有什么作用的。

大家都知道，比较常用的虚拟滚动就是只显示中间用户能够看的见的值，其余用户看不见的值，就填充空白的div以优化性能。

![image](https://user-images.githubusercontent.com/2912039/230706172-d81bb2ca-06d4-4a57-9c1a-7e97d5ae36c8.png)

但是这次在做虚拟滚动的时候却发现当你往上方填充空白区间的时候，scrollTop属性也跟着更新了，导致了计算时候的一些错误。后来发现是CSS overflow-anchor属性导致的问题。下面我来讲讲这个滚动锚定属性是有什么作用的。

## 什么是滚动锚定

滚动锚定是一种浏览器功能，它是用来防止你在 DOM 完全加载之前向下滚动网页的常见情况，如果没有滚动锚定，你所看到的内容就会一直被往下推。大家可能有过这样的浏览体验，就是图片很多的时候，例如漫画网站，在手机端，垂直布局这种，如果上方的图片加载慢，那么下方的图片看着看着就会被推下来，然后自己又要重新去滚动定位。

这是一个不太友好的浏览器体验行为。 于是，Chrome 56（2017年）和Firefox 66（2019年）开始，这些浏览器就对滚动行为进行了优化，实现了一种“滚动锚定”的交互行为。 具体描述为：当前视区上面的内容突然出现的时候，浏览器自动改变滚动高度，让视区窗口区域内容固定，就像滚动效果被锚定一样。

因此，在PC端，在Chrome浏览器下和Firefox浏览器下，当你浏览网页的时候，是感觉不到页面跳动的，就是滚动锚定在其作用。

## overflow-anchor属性

overflow-anchor属性的值非常简单，它接受两个值，它们本质上切换是否启用该功能。

```
overflow-anchor: [ auto | none ];
```

auto（默认）：在页面或元素应用它的部分启用滚动锚定。

none：禁用部分或全部网页的滚动锚定，或将 DOM 的一部分排除在锚定之外，从而允许内容重排。

overflow-anchor属性可以放在body中对全局生效，也可以单独放在某个元素中，对部分页面元素起作用。

## 应用案例

下面我们看看具体应用到元素中会有什么不同，下面的案例是实时效果，大家可以直接滚动操作，左边是默认的overflow-anchor:auto，右边设置的是overflow-anchor:none。

<iframe allowfullscreen="true" frameborder="no" scrolling="no" src="https://codepen.io/chriscoyier/embed/oWgENp?default-tab=result" style="height: 400px; width: 100%;" title="overflow-anchor">See the Pen <a href="https://codepen.io/chriscoyier/pen/oWgENp"> overflow-anchor</a> by Chris Coyier (<a href="https://codepen.io/chriscoyier">@chriscoyier</a>) on <a href="https://codepen.io">CodePen</a>.</iframe>

这个属性其实对于很多用户刷新应用都非常有用。 例如，一个聊天应用程序，在这个页面中，新消息会添加到底部的 DOM，如果你希望一直看到最新的消息，这个时候就可以把overflow-anchor设置为none，详细参考下面的demo：

<iframe allowfullscreen="true" frameborder="no" scrolling="no" src="https://codepen.io/chriscoyier/embed/bGbeBdp?default-tab=result" style="height: 400px; width: 100%;" title="&quot;Stay at the bottom&quot; scrolling with scroll-anchor">See the Pen <a href="https://codepen.io/chriscoyier/pen/bGbeBdp"> &amp;quot;Stay at the bottom&amp;quot; scrolling with scroll-anchor</a> by Chris Coyier (<a href="https://codepen.io/chriscoyier">@chriscoyier</a>) on <a href="https://codepen.io">CodePen</a>.</iframe>

## 总结

虽然overflow-anchor属性还不是W3C的标准，但是已经提上了日程，提供了规范的草案报告可供阅读，并且自版本 56 起已被 Chrome 采用。Mozilla 正在考虑在 Firefox 中使用类似的功能。 随着越来越多的浏览器采用滚动锚定功能，我们可能期望看到更多浏览器支持溢出锚定，因为它提供了明确的控制来选择是否使用滚动锚定这个特性。

![image](https://user-images.githubusercontent.com/2912039/230706404-76369b04-886e-4482-94f1-f8df6bdb54dd.png)
