# analytics-agent 规格说明

## Purpose
定义 `cz-cli analytics-agent` 命令族对 Analytics Agent 服务、domain、datasource、session 等 API 的封装要求。

## Requirements
### Requirement: analytics-agent 命令 help 签名稳定

本需求 MUST 按以下场景执行。

`analytics-agent` MUST 通过 help 暴露当前子命令组，并以命令 help 作为参数契约。

#### Scenario: group help

- **WHEN** 用户执行 `cz-cli analytics-agent --help`
- **THEN** help 展示 datasource、domain、service、session 等当前子命令组（以实现为准）
- **AND** 全局连接与输出格式参数可用

#### Scenario: 未知子命令

- **WHEN** 用户执行 `cz-cli analytics-agent unknown`
- **THEN** CLI 返回 usage error
- **AND** 不调用远端服务

### Requirement: id 参数本地校验为正整数

`analytics-agent` 命令族的资源 id 参数（如 `domain-id`、`dataset-id`、`attr-id`、`metric-id`、`analysis-id`、`node-id`、`space-id`、`join-id`、`table-id`、`datasource-id`、`question-id`、`session-id` 等）MUST 在发请求前本地校验为正整数（安全整数范围内、> 0）。非数字、小数、0、负数、超出安全整数范围的输入 MUST 直接返回 `USAGE_ERROR`，不得把非法值发给后端而暴露为 HTTP 500 或后端 NPE。表示根节点的 `parent-id`（允许为 0）不受此约束。

#### Scenario: 非数字 id 本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent domain detail abc`
- **THEN** CLI MUST 在发请求前直接返回 `USAGE_ERROR`
- **且** 错误信息 MUST 说明该 id 必须是正整数
- **AND** 不调用远端服务

#### Scenario: 小数 / 0 / 负数 / 溢出 id 本地拒绝

- **WHEN** 用户对任一资源 id 传入 `27.5`、`0`、`-1` 或超出安全整数范围的值（如 `99999999999999999999`）
- **THEN** CLI MUST 在发请求前直接返回 `USAGE_ERROR`
- **AND** 不调用远端服务

#### Scenario: 合法 id 正常放行

- **WHEN** 用户传入正整数 id
- **THEN** 校验通过并正常调用远端服务

#### Scenario: parent-id 允许为 0（根节点）

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge file list <space-id> --parent-id 0`
- **THEN** CLI MUST NOT 因 `parent-id=0` 报 `USAGE_ERROR`
- **且** 正常按根节点查询

### Requirement: 分页 list 命令透出总量并提示截断

当后端 list 响应携带分页信息（`total`/`pageNum`/`pageSize`/`pageCount`）时，`analytics-agent` 的分页类命令（metric list、answer-builder list、datasource list 等经 executeAnalyticsCommand 的命令）MUST 把这些字段透出到输出（`total`、`page_num`、`page_size`、`page_count`、`has_more`），不得只保留等于当前页条数的 `count`。当仍有后续页（`has_more` 为真）时，MUST 通过 `ai_message` 提示总量与翻页方式。目的：避免当前页条数恰好等于 page_size 时无法判断是否还有数据、导致漏读。

#### Scenario: 结果被分页截断时透出总量并提示

- **WHEN** 某域有 14 条 answer-builder，用户执行 `cz-cli analytics-agent answer-builder list --domain-id <id>`（默认 page_size 10）
- **THEN** 输出 MUST 包含 `count=10`、`total=14`、`page_count=2`、`has_more=true`
- **且** `ai_message` MUST 提示"Showing 10 of 14"及用 `--page-num`/`--page-size` 获取其余数据

#### Scenario: 单页结果不设 has_more

- **WHEN** 结果总量不超过一页
- **THEN** 输出 `has_more` 为 `false`
- **且** 不输出翻页提示 `ai_message`

### Requirement: service strict-ready 快速检查 strict/KB 索引能力

`cz-cli analytics-agent service strict-ready` MUST 使用 Analytics Agent Open API 的索引状态接口做低成本 readiness 检查，用于判断当前 profile/endpoint 是否适合继续调用 `analytics-agent session dryrun` 以及依赖 metric/answer-builder 系统知识库索引的命令。命令 MUST 要求 `--domain-id`，MAY 接受可重复的 `--metric-id` 和 `--answer-builder-id`；未显式提供资源 id 时，CLI SHOULD 分别从 metric list 与 answer-builder list 各取 1 条样本再检查索引状态。

输出 MUST 包含 `ready`、`status`、`domain_id`、`checks` 与 `ai_message`。当远端不支持索引状态 API（HTTP 404/405/501 或业务错误表明 not found / unsupported）时，CLI MUST 返回 `ready=false`、`status=UNSUPPORTED`，并通过 `ai_message` 明确指导本地 agent：当前 endpoint/profile 可能未开启白名单或后端版本不支持，不要继续使用 `session dryrun` 与 KB index 相关命令。

#### Scenario: 显式 metric 已索引时返回 ready

- **WHEN** 用户执行 `cz-cli analytics-agent service strict-ready --domain-id 195 --metric-id 568`
- **AND** 远端索引状态接口返回该 metric 已索引
- **THEN** CLI MUST 调用 `POST /open/api/v1/analytics-agent/index/status`
- **且** 请求体包含 `type=metric`、`id=568`、`domainId=195`、`includeContent=false`
- **AND** 输出 `ready=true`、`status=READY`

#### Scenario: 显式 answer-builder 未索引时指导 agent 绕过

- **WHEN** 用户执行 `cz-cli analytics-agent service strict-ready --domain-id 195 --answer-builder-id 9`
- **AND** 远端索引状态接口返回该 answer-builder 未索引
- **THEN** CLI MUST 输出 `ready=false`、`status=NOT_READY`
- **AND** `ai_message` MUST 指导本地 agent 避免对该 profile/endpoint 使用 strict dryrun 与 KB index 相关命令，直到白名单/索引完成

#### Scenario: 未提供 id 时自动抽样检查

- **WHEN** 用户执行 `cz-cli analytics-agent service strict-ready --domain-id 195`
- **THEN** CLI SHOULD 调用 metric list 与 answer-builder list 获取样本
- **AND** 对能获取到的样本调用索引状态接口
- **AND** 根据样本索引结果输出 `READY` 或 `NOT_READY`

#### Scenario: 无可检查样本时返回 NO_SAMPLE

- **WHEN** 用户执行 `cz-cli analytics-agent service strict-ready --domain-id 195`
- **AND** 当前 domain 没有可抽样的 metric 或 answer-builder
- **THEN** CLI MUST 输出 `ready=false`、`status=NO_SAMPLE`
- **AND** `ai_message` MUST 指导本地 agent 不要仅凭该结果使用 strict dryrun，除非用户提供具体 metric/answer-builder id 再检查

### Requirement: 输出字段面向用户和 agent

本需求 MUST 按以下场景执行。

Analytics Agent API 的输出 MUST 使用产品/领域友好的字段名，并适合 table-first 渲染。

#### Scenario: 列表输出

- **WHEN** 用户执行 analytics-agent 的 list 类命令并指定 `--format table`
- **THEN** 主要 ID、name、status、created/updated 字段位于顶层
- **AND** raw backend payload 仅放在明确 raw/debug 字段中

#### Scenario: 枚举值

- **WHEN** 后端返回数字或 magic string 状态
- **THEN** 输出 SHOULD 同时提供可读 label 字段
- **AND** 不要求 agent 查后端枚举表才能理解结果

### Requirement: 错误可诊断

本需求 MUST 按以下场景执行。

Analytics Agent 命令 MUST 将远端错误映射为结构化 CLI 错误。

#### Scenario: 权限不足

- **WHEN** 远端返回权限不足
- **THEN** CLI 输出业务错误 code 和 message
- **AND** `ai_message` SHOULD 指导检查 profile、service 或权限

#### Scenario: 资源不存在

- **WHEN** 用户请求不存在的 domain/session/datasource
- **THEN** CLI 返回 not found
- **AND** 错误包含请求标识
