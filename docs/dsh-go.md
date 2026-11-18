# DSH Go 与手机端接入

[English](dsh-go.en.md)

`dsh-attune` 的题目、规则与证据保存在运行 DSH 的宿主中。手机 App 负责显示和提交。不同连接方式可能指向不同宿主，因此手机本机档案与电脑上的档案不会自动合并。

## DSH Go

同一个插件包同时提供 DSH Web 页面、DSH Go 原生面板和 `/attune` 文字命令。原生面板使用 DSH Go 的 `dshGo` 清单和 `ctx.dshGo.panel`，仅在 Host 具有 `dshGo` 桥接时注册。缺少桥接不会阻止宿主插件的其他部分启动。

| 连接方式 | 原生面板 | 文字命令 | Web 页面 |
|---|---|---|---|
| 手机本机引擎 | 有桥接时可用 | 可用 | 可用 |
| SSH 主机 | 当前桥接尚未开放 | 可用 | DSH Go 的网页岛可用 |
| 中转主机 | 中转不放行桥接路径 | 可用，取决于远端命令能力 | 不支持网页岛 |

这些限制来自 DSH Go 的[主机覆盖文档](https://github.com/ccch1mneyyy/dsh-Go/blob/main/docs/plugins/hosts.md)。面板使用有界的 JSON 组件，题目选项通过 `options` 提交；答题、确认、拒绝都由宿主执行，App 不运行插件代码。工具卡目前只读，因此没有承担答题按钮。[插槽参考](https://github.com/ccch1mneyyy/dsh-Go/blob/main/docs/plugins/slots.md)、[动作说明](https://github.com/ccch1mneyyy/dsh-Go/blob/main/docs/plugins/actions.md)

原生面板先由 DSH 生成一题，再直接答题、记住或拒绝规则。支持视图 v2 的 DSH Go App 会提供可选的「当前情境」文本框；旧版 v1 面板可一键生成，情境留空，由宿主已有偏好与未探索维度引导出题。生成会显示等待状态，模型不可用时把错误留在面板。原生面板本身不读取当前 Agent 会话内容；需要指定具体情境时，使用输入框或 `/attune test <情境>` 命令。

想回顾一次聊得不太顺的对话，可以把选段粘贴进 v2 面板的「根据选段出题」表单，再补一句哪里不太顺。也可在支持宿主命令的客户端输入 `/attune excerpt <选段>`。加载标准 DSH Web 界面时，可以长按聊天或文档预览里的选区并点「根据选段出题」。

选段学习出的沟通偏好会建议适用的人格。原生面板里可点选一个或多个人格，再点「记给选中的人格」。文字端可用 `/attune personas` 查 ID，再用 `/attune remember <候选ID> ideas,review` 多选或填 `general`。回答时的人格判断由宿主完成。用 `/attune persona-review` 查看或处理创建、拆分和合并建议。

面板以「大肥鱼的默契小屋」呈现，出题、等你选择、等你确认时各有一句相应的小鱼提示。「教我怎么问」会另生成一道关于插件自身问法的小测试，探索俏皮或平和的语气、称呼和邀请方式；v2 面板可以补充「少用叠词」这类具体想法，v1 面板直接出题。选完仍要点「记住这个」才生效。档案里以「提问方式」标出这类偏好，它们只影响后续默契题的生成；普通协作偏好标作「相处偏好」。两类都可纠正和删除。

点击某条已记住的规则会将 `/attune correct <ruleId> ` 或 `/attune delete <ruleId>` 填入输入框，由用户补充修正文字或发送删除命令；只有用户自行在删除命令末尾加 `forget` 才同时忘记证据。文字命令在本机、SSH、中转路径均是核心入口：

```text
/attune test [当前情境]
/attune excerpt <选段>
/attune tone [想调整的问法]
/attune answer <testId> <optionId>
/attune remember <proposalId>
/attune reject <proposalId>
/attune list
/attune correct <ruleId> <新的说法>
/attune delete <ruleId> [forget]
```

原生面板是渐进增强；全流程不依赖它。`dsh-go` 对普通命令、技能、提问及模型输出 `dsh-ui` 选项有原生显示能力，但当前插件的答题操作不要求模型生成卡片。[已有原生能力](https://github.com/ccch1mneyyy/dsh-Go/blob/main/docs/plugins/native-for-free.md)

## Whaleness、DSHA 与电脑端

[Whaleness](https://github.com/Clarklevis1995/dsh-mobile) 的 Android/iOS App 通过 Mobile Gateway 连接电脑 DSH，README 明确支持宿主提供的斜杠命令和 Human Questions。因此第一版以 `/attune` 命令完成整个学习与纠正流程；Whaleness 不运行任意 DSH Web 插件页面，不把 Web 卡片计入其原生验收。须在装有 [Mobile Gateway](https://github.com/Clarklevis1995/dsh-plugin-mobile-gateway) 的真实宿主与 App 上测通命令、断线重连、问题恢复及跨端规则可见性。

[DSHA](https://github.com/DSH-APP/DSHA) 在 Android 本地运行 DSH，并显示 Web UI；应把插件安装到其实际启动的 Web profile，验证预构建 JS 在所捆绑内核运行，手机后台关闭/重启后状态仍在。电脑 Web 与官方 Desktop 使用同一 Web client 插件，但各 profile 必须分别安装/启用。Web 端 API 通过宿主认证连接，部署在子路径或桌面自定义 origin 时不构造固定 localhost 地址。

### 小桌宠在哪些界面出现

| 界面 | 呈现方式 | 提问语气学习 |
|---|---|---|
| DSH Web、官方 Desktop 的 Web 插件界面 | DSH 窗口里的女仆小桌宠，点开测试，带轻动画 | 图形界面与文字命令 |
| DSHA 加载的标准 Web UI | 页面内小桌宠，适配触屏 | 图形界面与文字命令 |
| DSH Go 原生面板 | 原生卡片、小鱼提示与按钮，遵循 App 支持的 JSON 组件 | 「教我怎么问」与文字命令 |
| Whaleness、DSH Go SSH／中转 | 宿主返回的文字测试 | `/attune tone`，再确认／纠正／删除 |

这里的 Web 小桌宠使用 DSH 的 `shell.overlay` 插槽，活动范围是当前 DSH 页面／窗口；最小化窗口后不会继续显示在系统桌面上。Android／iOS 原生面板也没有跨 App 悬浮宠物或任意 CSS 动画。上述呈现范围依据宿主接口划分，真实设备的动作与布局仍按下列验收表核实。

## 发布前的实测记录

- DSH Go：本机面板答题→确认→纠正→删除；提问语气题遵循同一流程；出题取消后可重试，待确认时不会覆盖上一题；SSH/中转用文字命令完成同样流程；旧版 App 的面板能力降级可见。
- Whaleness：Android 和 iOS 分别验证命令入口、返回文本、离线再连、同宿主电脑端规则立即可见。
- DSHA：捆绑 DSH 版本和实际插件安装方式、Web 页面操作、重启与数据升级保留。
- 电脑端：官方 Web/桌面、HTTPS 子路径反代、重复提交和双端同时操作。

目前上述结论来自项目文档及本插件单元测试；真实 App/设备验收完成后才能给具体组合标记“已验证”。
