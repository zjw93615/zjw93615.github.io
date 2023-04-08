module.exports = {
    title: '自家小仓库',
    description: '技术文档',
    themeConfig: {
        logo: '/assets/imgs/logo.png',
        sidebarDepth: 0,
        nav: [
            { text: '首页', link: '/' },
            {
                text: '前端',
                items: [
                    {text: 'Javascript', link: '/Javascript/es6'},
                    {text: '杂谈', link: '/杂谈/CSS%20overflow-anchor属性的一些坑'}
                ]
            },
            { text: 'External', link: 'http://jiawei.space' },
        ]
    },
    plugins: {
        "vuepress-plugin-auto-sidebar": {}
    }
}
