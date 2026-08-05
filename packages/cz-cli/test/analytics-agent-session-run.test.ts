import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

mock.module("../src/connection/profile-store.js", () => ({
  readAgentEndpoint: () => "https://example.clickzetta.com",
}))

mock.module("../src/commands/studio-context.js", () => ({
  getProfileAgentContext: () => undefined,
  getStudioContext: async () => ({
    token: "studio-token",
    instanceId: 11,
    workspaceId: 22,
    projectId: 33,
    userId: 44,
    tenantId: 55,
    instanceName: "inst",
    workspaceName: "ws",
    env: "uat",
    baseUrl: "https://example.clickzetta.com",
    customHeaders: {},
    userName: "tester",
  }),
}))

mock.module("../src/logger.js", () => ({
  logOperation: () => {},
}))

const { createCli } = await import("../src/cli.ts")
const { registerAnalyticsAgentCommand } = await import("../src/commands/analytics-agent.ts")

const originalFetch = globalThis.fetch
const originalStdoutWrite = process.stdout.write.bind(process.stdout)
const originalStderrWrite = process.stderr.write.bind(process.stderr)

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function parseError(output: string): { code: string; message: string } {
  return JSON.parse(output.trim()).error
}

async function runAnalyticsCli(args: string[]): Promise<{ exitCode: number; output: string }> {
  const chunks: string[] = []
  const savedExitCode = process.exitCode

  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString())
    return true
  }) as typeof process.stdout.write

  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString())
    return true
  }) as typeof process.stderr.write

  process.exitCode = 0
  try {
    const cli = createCli(args)
    registerAnalyticsAgentCommand(cli)
    await cli.demandCommand(1, "").help().parseAsync()
  } catch {
    if (!process.exitCode) process.exitCode = 1
  } finally {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
  }

  const exitCode = process.exitCode ?? 0
  process.exitCode = savedExitCode ?? 0
  return { exitCode, output: chunks.join("") }
}

describe("analytics-agent session run", () => {
  beforeEach(() => {
    process.exitCode = 0
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    process.exitCode = 0
  })

  test("outputs the raw safe_question_poll payload by default", async () => {
    const pollPayload = {
      success: true,
      data: {
        questionId: 123,
        responses: [
          {
            resGroupId: 1,
            dataType: "thinking",
            modelRes: { data: { message: "step 1" } },
          },
          {
            resGroupId: 1,
            dataType: "summary",
            modelRes: { data: { message: "final answer" } },
          },
          {
            resGroupId: 1,
            dataType: "finish",
            modelRes: { data: { message: "done" } },
          },
        ],
      },
    }

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/open/text2insight/query")) {
        return jsonResponse({ data: { questionId: 123 } })
      }
      if (url.includes("/open/safe_question_poll")) {
        return jsonResponse(pollPayload)
      }
      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--domain-id",
      "195",
      "--session-id",
      "7",
      "--msg",
      "hello",
    ])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.output.trim())).toEqual(pollPayload)
  })

  test("shows plain-text final summary when --summary and --format text are set", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/open/text2insight/query")) {
        return jsonResponse({ data: { questionId: 123 } })
      }
      if (url.includes("/open/safe_question_poll")) {
        return jsonResponse({
          success: true,
          data: {
            questionId: 123,
            responses: [
              {
                resGroupId: 1,
                dataType: "summary",
                modelRes: { data: { message: "final answer" } },
              },
              {
                resGroupId: 1,
                dataType: "finish",
                modelRes: { data: { message: "done" } },
              },
            ],
          },
        })
      }
      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--domain-id",
      "195",
      "--session-id",
      "7",
      "--msg",
      "hello",
      "--summary",
      "--format",
      "text",
    ])

    expect(result.exitCode).toBe(0)
    expect(result.output.trim()).toBe("final answer")
  })

  test("shows structured json when --summary and --format json are both set", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/open/text2insight/query")) {
        return jsonResponse({ data: { questionId: 123 } })
      }
      if (url.includes("/open/safe_question_poll")) {
        return jsonResponse({
          success: true,
          data: {
            questionId: 123,
            responses: [
              {
                resGroupId: 1,
                dataType: "summary",
                modelRes: { data: { message: "final answer" } },
              },
              {
                resGroupId: 1,
                dataType: "finish",
                modelRes: { data: { message: "done" } },
              },
            ],
          },
        })
      }
      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--domain-id",
      "195",
      "--session-id",
      "7",
      "--msg",
      "hello",
      "--summary",
      "--format",
      "json",
    ])

    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.output.trim()) as Record<string, unknown>
    expect(parsed.data).toBe("final answer")
  })

  test("rejects session-id only run before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--session-id",
      "7",
      "--msg",
      "hello",
    ])

    expect(result.exitCode).toBe(2)
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toContain("--domain-id is required")
  })

  test("auto-creates session with domain-id and reuses returned sessionId", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      calls.push({ url, body })
      if (url.includes("/open/session/safe_new")) {
        return jsonResponse({ success: true, data: "88" })
      }
      if (url.includes("/open/text2insight/query")) {
        return jsonResponse({ data: { questionId: 123 } })
      }
      if (url.includes("/open/safe_question_poll")) {
        return jsonResponse({
          success: true,
          data: {
            questionId: 123,
            responses: [
              { resGroupId: 1, dataType: "finish", modelRes: { data: { message: "done" } } },
            ],
          },
        })
      }
      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--domain-id",
      "195",
      "--msg",
      "hello",
    ])

    expect(result.exitCode).toBe(0)
    expect(calls[0]?.url).toContain("/open/session/safe_new")
    expect(calls[0]?.body).toMatchObject({ domainId: 195, title: "hello" })
    expect(calls[1]?.url).toContain("/open/text2insight/query")
    expect(calls[1]?.body).toMatchObject({ domainId: 195, sessionId: 88, msg: "hello" })
  })

  test("rejects blank msg before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--domain-id",
      "195",
      "--msg",
      "   ",
    ])

    expect(result.exitCode).toBe(1)
    expect(parseError(result.output)).toEqual({
      code: "USAGE_ERROR",
      message: "--msg must be non-empty",
    })
  })

  test("merges multiple --model-setting entries into modelSettings with loose typing", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      calls.push({ url, body })
      if (url.includes("/open/text2insight/query")) {
        return jsonResponse({ data: { questionId: 123 } })
      }
      if (url.includes("/open/safe_question_poll")) {
        return jsonResponse({
          success: true,
          data: {
            questionId: 123,
            responses: [
              { resGroupId: 1, dataType: "finish", modelRes: { data: { message: "done" } } },
            ],
          },
        })
      }
      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--domain-id",
      "195",
      "--session-id",
      "7",
      "--msg",
      "hello",
      "--model-setting",
      "thinkingLevel=off",
      "--model-setting",
      "language=zh-CN",
    ])

    expect(result.exitCode).toBe(0)
    const queryCall = calls.find((call) => call.url.includes("/open/text2insight/query"))
    expect(queryCall?.body).toMatchObject({
      domainId: 195,
      sessionId: 7,
      msg: "hello",
      modelSettings: { thinkingLevel: "off", language: "zh-CN" },
    })
  })

  test("--model-setting overrides --model-name", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      calls.push({ url, body })
      if (url.includes("/open/text2insight/query")) {
        return jsonResponse({ data: { questionId: 123 } })
      }
      if (url.includes("/open/safe_question_poll")) {
        return jsonResponse({
          success: true,
          data: {
            questionId: 123,
            responses: [
              { resGroupId: 1, dataType: "finish", modelRes: { data: { message: "done" } } },
            ],
          },
        })
      }
      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--domain-id",
      "195",
      "--session-id",
      "7",
      "--msg",
      "hello",
      "--model-name",
      "deepseek",
      "--model-setting",
      "model_name=qwen",
    ])

    expect(result.exitCode).toBe(0)
    const queryCall = calls.find((call) => call.url.includes("/open/text2insight/query"))
    const modelSettings = (queryCall?.body as Record<string, unknown>)?.modelSettings as Record<string, unknown>
    expect(modelSettings?.model_name).toBe("qwen")
  })

  test("omits modelSettings when no model params are set", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      calls.push({ url, body })
      if (url.includes("/open/text2insight/query")) {
        return jsonResponse({ data: { questionId: 123 } })
      }
      if (url.includes("/open/safe_question_poll")) {
        return jsonResponse({
          success: true,
          data: {
            questionId: 123,
            responses: [
              { resGroupId: 1, dataType: "finish", modelRes: { data: { message: "done" } } },
            ],
          },
        })
      }
      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--domain-id",
      "195",
      "--session-id",
      "7",
      "--msg",
      "hello",
    ])

    expect(result.exitCode).toBe(0)
    const queryCall = calls.find((call) => call.url.includes("/open/text2insight/query"))
    expect(queryCall?.body).not.toHaveProperty("modelSettings")
  })

  test("session dryrun submits async strict request and polls job result", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const pollPayload = {
      data: {
        jobId: "job-1",
        status: "SUCCESS",
        result: { status: "SUCCESS", source: "STRICT" },
      },
    }

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      calls.push({ url, body })
      if (url.includes("/open/text2insight/dryrun/async/poll")) {
        return jsonResponse(pollPayload)
      }
      if (url.includes("/open/text2insight/dryrun/async")) {
        return jsonResponse({ data: { jobId: "job-1", status: "RUNNING" } })
      }
      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "dryrun",
      "--domain-id",
      "195",
      "--question",
      "昨天订单量",
      "--session-id",
      "7",
      "--question-id",
      "123",
      "--model",
      "gpt-4.1",
      "--model-identifier",
      "openai/gpt-4.1",
      "--language",
      "zh-CN",
      "--validate-selected-candidate",
      "--ask-data-scope",
      '{"mode":"INCLUDE","metrics":[{"metricId":568}]}',
      "--include-schema-evidence",
      "--include-sample-values",
      "--sample-value-limit",
      "5",
      "--schema-evidence-table-column-limit",
      "30",
    ])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.output.trim())).toEqual(pollPayload)
    expect(calls[0]?.url).toContain("/open/text2insight/dryrun/async?tenantId=55")
    expect(calls[0]?.body).toMatchObject({
      tenantId: 55,
      userId: 44,
      loginToken: "studio-token",
      domainId: 195,
      sessionId: 7,
      questionId: 123,
      question: "昨天订单量",
      model: "gpt-4.1",
      modelIdentifier: "openai/gpt-4.1",
      language: "zh-CN",
      validateSelectedCandidate: true,
      askDataScope: { mode: "INCLUDE", metrics: [{ metricId: 568 }] },
      includeSchemaEvidence: true,
      includeSampleValues: true,
      sampleValueLimit: 5,
      schemaEvidenceTableColumnLimit: 30,
    })
    expect(calls[1]?.url).toContain("/open/text2insight/dryrun/async/poll?tenantId=55")
    expect(calls[1]?.body).toMatchObject({
      tenantId: 55,
      userId: 44,
      loginToken: "studio-token",
      jobId: "job-1",
    })
  })

  test("session dryrun supports no-wait submit only", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const submitPayload = { data: { jobId: "job-1", status: "RUNNING" } }

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      calls.push({ url, body })
      if (url.includes("/open/text2insight/dryrun/async")) {
        return jsonResponse(submitPayload)
      }
      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "dryrun",
      "--domain-id",
      "195",
      "--question",
      "昨天订单量",
      "--no-wait",
    ])

    expect(result.exitCode).toBe(0)
    expect(calls).toHaveLength(1)
    expect(JSON.parse(result.output.trim())).toEqual(submitPayload)
  })

  test("session dryrun rejects missing question before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "dryrun",
      "--domain-id",
      "195",
      "--question",
      "   ",
    ])

    expect(result.exitCode).toBe(1)
    expect(parseError(result.output)).toEqual({
      code: "USAGE_ERROR",
      message: "--question must be non-empty",
    })
  })

  test("session dryrun rejects non-object ask-data-scope before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "dryrun",
      "--domain-id",
      "195",
      "--question",
      "昨天订单量",
      "--ask-data-scope",
      "[]",
    ])

    expect(result.exitCode).toBe(1)
    expect(parseError(result.output)).toEqual({
      code: "USAGE_ERROR",
      message: "Invalid --ask-data-scope: --ask-data-scope must be a JSON object",
    })
  })

  test("session dryrun guides agents away when submit API is unsupported", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/open/text2insight/dryrun/async")) {
        return new Response("not found", { status: 404 })
      }
      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "dryrun",
      "--domain-id",
      "195",
      "--question",
      "昨天订单量",
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim()) as Record<string, unknown>
    const error = parsed.error as Record<string, unknown>
    expect(error.code).toBe("ANALYTICS_AGENT_DRYRUN_UNSUPPORTED")
    expect(String(parsed.ai_message)).toContain("Do not call `analytics-agent session dryrun` again")
    expect(String(parsed.ai_message)).toContain("session run")
  })

  test("session dryrun guides agents away when poll API is unsupported", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/open/text2insight/dryrun/async/poll")) {
        return new Response("not found", { status: 404 })
      }
      if (url.includes("/open/text2insight/dryrun/async")) {
        return jsonResponse({ data: { jobId: "job-1", status: "RUNNING" } })
      }
      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "dryrun",
      "--domain-id",
      "195",
      "--question",
      "昨天订单量",
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim()) as Record<string, unknown>
    const error = parsed.error as Record<string, unknown>
    expect(error.code).toBe("ANALYTICS_AGENT_DRYRUN_UNSUPPORTED")
    expect(String(parsed.ai_message)).toContain("Do not call `analytics-agent session dryrun` again")
  })

  test("session dryrun explains NOT_FOUND as possible wrong backend instance and asks retry", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/open/text2insight/dryrun/async/poll")) {
        return jsonResponse({
          data: {
            jobId: "job-1",
            status: "NOT_FOUND",
            error: "dryrun job not found or expired",
          },
        })
      }
      if (url.includes("/open/text2insight/dryrun/async")) {
        return jsonResponse({ data: { jobId: "job-1", status: "RUNNING" } })
      }
      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "dryrun",
      "--domain-id",
      "195",
      "--question",
      "昨天订单量",
    ])

    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.output.trim()) as Record<string, unknown>
    expect(String(parsed.ai_message)).toContain("different backend instance")
    expect(String(parsed.ai_message)).toContain("Retry the same `analytics-agent session dryrun` command once")
  })

  test("service strict-ready checks explicit metric index status", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      calls.push({ url, body })
      if (url.includes("/open/api/v1/analytics-agent/index/status")) {
        return jsonResponse({ data: { indexed: true, spaceId: 88, path: "/system/metrics/568" } })
      }
      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "service",
      "strict-ready",
      "--domain-id",
      "195",
      "--metric-id",
      "568",
    ])

    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.output.trim()) as Record<string, unknown>
    const data = parsed.data as Record<string, unknown>
    expect(data.ready).toBe(true)
    expect(data.status).toBe("READY")
    expect(calls).toHaveLength(1)
    expect(calls[0]?.body).toMatchObject({
      type: "metric",
      id: 568,
      domainId: 195,
      includeContent: false,
    })
  })

  test("service strict-ready guides agents away when answer-builder is not indexed", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/open/api/v1/analytics-agent/index/status")) {
        return jsonResponse({ data: { indexed: false, spaceId: 88 } })
      }
      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "service",
      "strict-ready",
      "--domain-id",
      "195",
      "--answer-builder-id",
      "9",
    ])

    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.output.trim()) as Record<string, unknown>
    const data = parsed.data as Record<string, unknown>
    expect(data.ready).toBe(false)
    expect(data.status).toBe("NOT_READY")
    expect(String(parsed.ai_message)).toContain("Do not call `analytics-agent session dryrun`")
    expect(String(parsed.ai_message)).toContain("KB index commands")
  })

  test("service strict-ready auto-samples metric and answer-builder", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      calls.push({ url, body })
      if (url.includes("/metrics/list")) {
        return jsonResponse({ data: [{ id: 568, name: "最大成交金额" }], total: 1, pageNum: 1, pageSize: 1 })
      }
      if (url.includes("/answer-builders/list")) {
        return jsonResponse({ data: [{ analysisId: 9, analysisName: "区域汇总" }], total: 1, pageNum: 1, pageSize: 1 })
      }
      if (url.includes("/index/status")) {
        return jsonResponse({ data: { indexed: true } })
      }
      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "service",
      "strict-ready",
      "--domain-id",
      "195",
    ])

    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.output.trim()) as Record<string, unknown>
    const data = parsed.data as Record<string, unknown>
    const checks = data.checks as Record<string, unknown>[]
    expect(data.ready).toBe(true)
    expect(checks.map((check) => check.type)).toEqual(["metric", "answer-builder"])
    expect(calls.filter((call) => call.url.includes("/index/status"))).toHaveLength(2)
  })

  test("service strict-ready returns no-sample when domain has no metric or answer-builder", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/metrics/list") || url.includes("/answer-builders/list")) {
        return jsonResponse({ data: [], total: 0, pageNum: 1, pageSize: 1 })
      }
      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "service",
      "strict-ready",
      "--domain-id",
      "195",
    ])

    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.output.trim()) as Record<string, unknown>
    const data = parsed.data as Record<string, unknown>
    expect(data.ready).toBe(false)
    expect(data.status).toBe("NO_SAMPLE")
    expect(String(parsed.ai_message)).toContain("--metric-id")
    expect(String(parsed.ai_message)).toContain("--answer-builder-id")
  })

  test("service strict-ready reports unsupported index API without failing the probe", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/open/api/v1/analytics-agent/index/status")) {
        return new Response("not found", { status: 404 })
      }
      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "service",
      "strict-ready",
      "--domain-id",
      "195",
      "--metric-id",
      "568",
    ])

    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.output.trim()) as Record<string, unknown>
    const data = parsed.data as Record<string, unknown>
    expect(data.ready).toBe(false)
    expect(data.status).toBe("UNSUPPORTED")
    expect(String(parsed.ai_message)).toContain("whitelist-enabled")
    expect(String(parsed.ai_message)).toContain("Do not call `analytics-agent session dryrun`")
  })
})
