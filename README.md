# dsh-attune · 默契小实验

让 DeepSeek Harness（DSH）通过 20～45 秒的小选择逐渐了解你的协作偏好。每个答案只形成一条**待确认**的规律；你确认后，DSH 才会在后续相关回答中参考它。规律可查看来源、改写、删除，也可同时清除对应的答题依据。

这是可安装的首版实现。每道题由 DSH 当前配置的模型临时生成，参考当前情境、已确认偏好、尚未摸清的维度和最近的题目。生成器会检查两种选项是否落在同一偏好维度、是否对应可执行的规律；生成失败会显示错误，不会偷偷换成预制题。当前覆盖回答顺序、长度、解释方式、卡关时的帮助、反馈方式和创意偏好六种维度，不推断人格。

## 安装

DSH 0.2.1-rc.1 至 0.2.x 的插件接口为目标。已在 Windows 和 Linux 的 DSH 0.2.2-rc.1 Web profile 验证 npm 安装和卸载，真模型测试见下文。运行新版 DSH 时以其自身 Node 要求为准。插件仅使用 JavaScript 和 JSON，无安装脚本或原生模块。生成小测试会调用你在 DSH 中配置的默认模型，产生相应模型用量；也可在插件配置中设置 `generatorProvider`、`generatorModel`。

在实际运行会话的 DSH 宿主上从 [npm](https://www.npmjs.com/package/dsh-attune) 安装本包，并重启宿主：

```text
dsh plugin --profile web add dsh-attune@0.1.0
```

官方 Desktop 使用它自己的插件管理页，或用 Desktop 自带命令安装到 `desktop` profile。DSHA、DSH Go 手机本机引擎安装到其实际使用的 `web` profile；Whaleness 使用电脑宿主上的安装。安装到一个 profile 不会自动启用其他 profile。

## 卸载与数据

在安装插件的 DSH 宿主上，按实际使用的 profile 移除。例如 Web profile：

```text
dsh plugin --profile web remove dsh-attune
```

操作后重启该宿主。`dsh plugin` 会将命令交给 pnpm；普通 CLI 需要 pnpm 在 PATH 中。其他 profile 需将 `web` 换成实际名称。Windows 上已在 DSH 0.2.2-rc.1 的隔离 Web profile 验证安装与卸载。

官方 Desktop 可使用应用中的插件管理页移除。使用命令行时，需先至少启动一次 Desktop 以初始化 profile，然后完全退出 Desktop；使用由 Desktop 安装的 `dsh` 命令运行 `dsh plugin --profile desktop remove dsh-attune`，再重新打开 Desktop。普通 npm 版 `dsh` 不能管理 Desktop profile；具体 Desktop 版本与本插件的实机操作仍待验。详见 [DSH 官方 CLI](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md) 和 [Desktop 文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md)。

卸载插件不会自动删除偏好档案。默认文件为 `$DSH_HOME/storages/dsh-attune/state.json`；未设置 `DSH_HOME` 时，默认位于用户主目录的 `.dsh/storages/dsh-attune/state.json`。若配置过 `dataDir`，则位于该目录下的 `state.json`。如需彻底清除，请先停止使用同一档案的 DSH 宿主，核对实际路径后自行删除该插件数据；同一宿主上的其他 profile 可能共用它。



## 怎么用

电脑 Web、官方 Desktop 和加载标准 Web 插件的移动页面，打开侧栏底部的“🎲 默契”面板，可以填一句眼前在忙的事，再点“生成一题”。不填写时，DSH 根据已有偏好和未知维度出题。选项会生成带来源的候选偏好；确认后立即能在偏好页看到它。纠正时直接修改文字；删除时可选择“同时忘记答题依据”。新偏好从下一次模型请求开始使用。

原生手机客户端可以使用文字命令：

```text
/attune test [眼前情境]              # 按当前会话与情境生成新题
/attune test list                    # 查看最近生成的题
/attune answer <题目ID> <选项ID>      # 提交答案
/attune remember <候选ID>            # 确认偏好
/attune reject <候选ID>              # 不采纳
/attune list                         # 查看已确认与待确认偏好
/attune correct <规则ID> <新文字>     # 纠正
/attune delete <规则ID>              # 删除规则
/attune delete <规则ID> forget       # 同时忘记来源证据
```

`/attune on` 开启“打开默契页时偶尔推荐一道题”，`/attune off` 关闭。推荐至少间隔 72 小时、每七天最多两次。它不会主动发送手机系统通知，也不会在宿主关闭时补发。

同一 DSH 宿主上的手机与电脑共享档案。手机本机引擎和另一台电脑宿主各有自己的档案。默认按单主人宿主设计；共享同一宿主访问凭据的多人尚不能得到可靠的个人档案隔离。

## 已实现的接入方式

| 入口 | 首版能力 | 验收状态 |
|---|---|---|
| DSH Web、官方 Desktop | 响应式卡片、规则管理、文字命令、上下文偏好 | Windows 和 Linux 已验证 npm 安装与卸载，Linux 已通过 DeepSeek 官方 API 出题和偏好流程实测，Desktop 应用待实机验收 |
| DSH Go 手机本机 | 原生面板答题、确认、拒绝；文字命令纠正与删除；也可用 Web 界面 | 对照 DSH Go JSON Schema 和模拟桥接测试；真机待验 |
| DSH Go SSH、中转 | 文字命令；网页岛仅在接入模式允许时使用 | 协议分析通过；真机待验 |
| DSHA | 使用内置 DSH 的 Web 插件和文字命令 | 真机待验 |
| Whaleness Android/iOS | 走宿主下发的 `/attune` 文字命令 | Gateway/App 真机待验；Web 插件界面未作为原生能力 |

各手机模式的依据和测试清单见 [DSH Go 与手机端接入](docs/dsh-go.md)。客户端界面是否会显示，取决于手机 App 所支持的插件 UI 协议；宿主能安装插件不等于原生 App 自动显示网页面板。

### H100 服务器实测

从 npm 安装 `dsh-attune@0.1.0` 后，在 H100 服务器上用 Linux DSH Web（0.2.2-rc.1）连接 DeepSeek 官方 API，模型选用 `deepseek-flash`。讲解实验复现、审阅志愿者招募公告、处理投屏故障这三个情境各生成了一道二选一题，出题接口耗时分别为 1.9、2.2 和 2.7 秒。比如，演示时投屏突然黑屏，题目会问你想先拿到一个能立刻试的步骤，还是先定位原因。

我核对了实际发给模型的聊天请求。答题后，插件先把结果存为候选，确认后的聊天请求才会带上这条偏好。把规则改成先用「蓝舟演示」开场、再举个例子后，模型用这个短语开场，并给出了具体例子。删除规则时选择忘记答题依据，规则和来源答案都从偏好档案里移除，新会话的请求也不再带上这条偏好。重复答题去重、拒绝候选和邀请冷却也通过了测试。

## 数据与边界

- 生成题目、答案、候选和已确认规则存于当前 DSH 宿主的 `$DSH_HOME/storages/dsh-attune/state.json`；配置 `dataDir` 可指定其他绝对目录。文件以原子替换和跨进程锁更新。生成题目会短暂使用当前会话最近的直接对话或用户提供的情境，模型请求限长；完整会话不会写入偏好档案。
- 只有已确认的规则会进入 DSH 后续请求的动态上下文，每次至多 8 条、900 字符。原始答题记录不会整个进入普通对话。
- 一次选择只生成待确认规律；已有规律若被反向答案挑战，会显示旧规律，用户确认后才替换。
- 当前没有跨独立宿主的自动同步，也没有针对原生手机 App 的推送或通知栏入口。
- 出现数据格式不兼容或损坏时，插件保留原文件并报错，不会用空档案覆盖。

## 开发验证

```text
npm test
npm pack --dry-run
```

测试覆盖动态题目校验、完整答题闭环、冲突与强化、重复提交、并发写入、邀请频控、认证 API、动态上下文、文字命令、DSH Go 桥接和 Web/Desktop 地址解析。许可证为 MIT。原项目 [dsh-novel-craft](https://github.com/shiyan688/dsh-novel-craft) 的“简单判断→可编辑规律→轻量上下文”是产品思想来源；本插件代码独立编写。
