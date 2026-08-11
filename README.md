# CleanShare

一个油猴脚本，净化 Bilibili / YouTube / 小红书的分享行为：点击分享按钮时复制「标题 + 净化链接」，去除跟踪参数与口令码。

## 功能

- **Bilibili**：拦截分享按钮，复制 `标题 https://www.bilibili.com/video/BVxxxx/`，去除 `?share_source=`、`?spm_id=`、`?t=` 等参数。
- **YouTube**：两种模式可选
  - 方案A：点击分享按钮直接复制，原生面板不弹出
  - 方案B（默认）：保留原生分享面板，点击面板内"复制"时替换为净化链接，去除 `&si=`、`&feature=` 等参数
- **小红书**：Hook 剪贴板 API，自动净化分享文本，去除数字前缀、`【... | 小红书 - 你的生活兴趣社区】`、口令码 `😆 xxx 😆`，只保留「标题 链接」。
- **设置面板**：通过油猴菜单「⚙ 打开设置面板」打开，左侧导航 + 右侧子项布局。

## 安装

项目已发布至[GreasyFork](https://greasyfork.org/zh-CN/scripts/590827-cleanshare-分享链接净化-bilibili-youtube-小红书)，推荐通过此方式安装脚本

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/) 或 Userscripts（Safari）
2. 点击 Tampermonkey 图标 → 新建脚本
3. 把 [share-cleaner.user.js](share-cleaner.user.js) 的内容粘贴进去，保存

## 输出示例

```
「TOMBOY 」时长分配但是楼兰版   你终于刷到我咧!  完颜慧德/核爆酱肘子/那艺娜/三梦奇缘 https://www.bilibili.com/video/BV1qC4y1E7bH/
```

```
《夜店我要聽》陳小雲 x 謝金燕 - 愛情恰恰 x 含淚跳恰恰 重拍混音 (Johnny Jumper Mashup Mix) https://www.youtube.com/watch?v=3-BoiSZ0Ods
```

```
主打一个干净耐看，没别的 - 生椰拿铁 https://www.xiaohongshu.com/discovery/item/6a541f990000000006030fc1?source=webshare&xhsshare=pc_web&xsec_token=ABXtIvR-F6ABq_Bh3xog7xn9uo9LVAJxB7WY7zQNClUwY=&xsec_source=pc_share
```

## 兼容性

- Safari + Userscripts / Tampermonkey
- Chrome / Edge + Tampermonkey
- 移动端 Bilibili / YouTube 网页

## License

[MIT](LICENSE)
