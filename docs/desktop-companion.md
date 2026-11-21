# dsh-attune 的 Windows 桌宠

在 Windows 版 DeepSeek Harness Desktop 安装并启用 dsh-attune 后，桌宠会出现在系统桌面上。按住角色可以拖动，双击可回到 DeepSeek Harness。窗口最小化时，桌宠仍然可用。

## 右键菜单

- **默契答题** 打开当前 DeepSeek Harness 窗口里的答题页。
- **查看余额** 在桌宠旁显示 DeepSeek 余额。登录 DeepSeek 的用户可以查看充值和赠送余额。默认使用官方 API Key 模型通道的用户，优先查询 `DEEPSEEK_API_KEY` 对应的余额。查询金额和凭据仅用于当次查询，插件不会写入偏好档案。
- **检查更新** 比较本地版本与 npm 当前的最新公开版。可从 DeepSeek Harness 插件管理页升级。
- **气泡闲聊** 和 **轻动画** 可以分别开关。气泡偶尔出现，闲聊文案随插件附带。
- **隐藏桌宠** 会记住隐藏状态，可在系统托盘或 **默契小屋 → 默契小本本** 中重新显示。桌宠随 DeepSeek Harness 一起退出。

在默契小屋的 **定制形象** 上传图片并保存，桌宠会同步使用同一套待机、思考、开心形象。

## API 峰时和谷时

价格牌并排显示 DeepSeek Flash 的人民币输出价，每百万 tokens 峰时 ¥8、谷时 ¥4。当前时段用橙色（峰时）或青绿色（谷时）高亮。按北京时间，周一到周五 09:00–12:00、14:00–18:00 为峰时，周末、节假日和其他时间为谷时。

![峰时和谷时的两种价格牌状态](images/desktop-api-prices.jpg)

[右键菜单和余额示例](images/desktop-balance-demo.jpg)

插件内置 2026 和 2027 年已公布的中国节假日安排。日历待更新的工作日显示「时段待核对」。价格牌标明了参考模型，实际费用请查看官方计价。 [DeepSeek 计价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) · [余额查询](https://api-docs.deepseek.com/zh-cn/api/get-user-balance/) · [2026 年假期](https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html) · [2027 年假期](https://chinajob.mohrss.gov.cn/h5/c/2026-11-09/635850.shtml)

## 安装

可在 DeepSeek Harness Desktop 的插件管理页安装或升级。使用命令行时，完全退出 Desktop，使用它随附的 `dsh` 命令，将插件装到 Desktop profile。

~~~powershell
dsh plugin --profile desktop add dsh-attune@0.4.0
~~~

重新打开 DeepSeek Harness Desktop 即可使用。Web 和移动端可以从各自的会话界面打开默契小屋。

## 从源码构建

在 64 位 Windows 上使用 .NET Framework 编译器和安装了 Pillow 的 Python。

~~~powershell
.\desktop\windows\build.ps1
npm pack --ignore-scripts
~~~

构建将 Windows 桌宠组件放在插件的 `lib/native` 下。内置形象来自 SlimeNull 与 Chubby Whale 贡献者，采用 CC BY-NC-SA 4.0。完整署名见 [素材说明](../ASSETS-NOTICE.md)。
