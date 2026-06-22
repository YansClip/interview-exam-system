/** 默认试卷种子数据 */
module.exports = {
  id: "default",
  title: "大模型工程师技术笔试",
  source: "https://k1qq9hin8un.feishu.cn/wiki/H1HTwFem8iYXa8kWeRdcP5xTnRc",
  durationMinutes: 60,
  job: "大模型工程师",
  codeMaxScore: 30,
  sections: [
    {
      id: "single",
      number: "01",
      title: "单选题",
      description: "每题只有一个正确答案。",
      questions: [
        {
          id: "single_1",
          type: "single",
          difficulty: "中等",
          score: 5,
          title:
            "在生产级 RAG 系统中，如果用户问题与知识库内容语义相近但关键词差异较大，最直接影响召回效果的模块通常是：",
          options: ["前端页面路由", "Embedding 模型与向量检索策略", "用户头像上传服务", "日志文件压缩格式"],
        },
        {
          id: "single_3",
          type: "single",
          difficulty: "难",
          score: 5,
          title: "关于 EER（Equal Error Rate），以下说法最准确的是：",
          options: [
            "EER 越高，说明声纹系统误识率越低",
            "EER 是 ASR 文本识别准确率指标",
            "EER 表示误拒率和误受率相等时的错误率，通常越低越好",
            "EER 只适用于图像识别，不适用于声纹识别",
          ],
        },
        {
          id: "single_4",
          type: "single",
          difficulty: "中等",
          score: 5,
          title: "大模型在线推理服务中，TTFT 通常表示：",
          options: ["首个 Token 返回耗时", "总训练时间", "文档切分数量", "GPU 显存总容量"],
        },
        {
          id: "single_5",
          type: "single",
          difficulty: "难",
          score: 5,
          title: "硬件设备接入云端大模型 API 时，以下哪项最不适合作为设备到云端的基础设计原则？",
          options: [
            "设备请求携带设备身份与鉴权信息",
            "云端对请求设置超时、重试和限流策略",
            "将大模型 API Key 直接硬编码在设备固件中",
            "设备状态和模型响应需要有可追踪日志",
          ],
        },
      ],
    },
    {
      id: "multiple",
      number: "02",
      title: "多选题",
      description: "每题答案不唯一，少选部分得分，多选不得分。",
      questions: [
        {
          id: "multi_1",
          type: "multiple",
          difficulty: "难",
          score: 8,
          title: "搭建公司产品知识库时，通常需要包含哪些关键步骤？",
          options: [
            "明确数据来源、权限和版本",
            "文档解析、清洗、去重与格式标准化",
            "按语义或结构进行切分，并补充元数据",
            "建立检索评测集和人工抽检机制",
            "删除所有原始文档，只保留向量",
          ],
        },
        {
          id: "multi_2",
          type: "multiple",
          difficulty: "难",
          score: 8,
          title: "面向天文、地理、数学等垂直领域构建定向知识库时，以下哪些做法是合理的？",
          options: [
            "建立领域术语表和同义词表",
            "对数据进行来源标注、难度标注和适用年龄段标注",
            "对高频问题建立标准答案与引用依据",
            "不需要评测集，只要把文档全部入库即可",
            "对错误、过期或冲突内容建立清洗和审核规则",
          ],
        },
        {
          id: "multi_3",
          type: "multiple",
          difficulty: "难",
          score: 8,
          title: "在生产环境部署大模型或 RAG 服务时，通常需要重点监控哪些指标？",
          options: [
            "QPS / 并发量",
            "TTFT / 总响应时间",
            "GPU 利用率、显存占用和 Token 成本",
            "检索命中率、引用准确率和失败请求日志",
            "页面主色调是否统一",
          ],
        },
      ],
    },
    {
      id: "scenario",
      number: "03",
      title: "场景客观题",
      description: "根据场景选择最优先处理的环节。",
      questions: [
        {
          id: "scenario_rag",
          type: "multiple",
          maxChoices: 2,
          difficulty: "很难",
          score: 13,
          title: "RAG 问答线上效果异常，日志如下。请选择最优先排查的 2 个环节。",
          prompt:
            "用户问题：“月食为什么会发生？”\n向量召回 Top5 中，第 4 条是正确片段：“月食发生在地球位于太阳和月球之间……”\n重排后只取 Top2 送入大模型：\nTop1：“月球表面有环形山和月海。”\nTop2：“太阳黑子是太阳表面的暗区。”\n模型输出引用 Top1，回答成“月球地貌形成原因”。",
          options: [
            "文档解析与清洗",
            "重排策略",
            "TopK 截断 / 上下文传入策略",
            "页面 CSS 样式",
            "用户登录状态",
          ],
        },
        {
          id: "scenario_hardware_ai",
          type: "multiple",
          maxChoices: 3,
          difficulty: "极难",
          score: 13,
          title: "某硬件设备接入 AI 大模型 API，出现误触发和未注册用户触发控制问题。请选择最优先改进的 3 个环节。",
          prompt:
            "链路：设备端采集语音 → VAD 判断是否有人声 → 上传音频片段 → 云端声纹确认 → ASR 转文字 → 大模型生成控制意图 → 下发设备控制指令。\n问题 1：嘈杂环境下，经常误触发请求，导致 API 成本上升。\n问题 2：偶发情况下，未注册用户也能触发设备控制。",
          options: [
            "在设备端或边缘侧加入 VAD 阈值、降噪和最短语音长度过滤",
            "在云端加入声纹确认阈值、失败拒绝策略和重试限制",
            "将大模型 API Key 写入设备端，减少云端鉴权耗时",
            "对设备请求增加设备身份鉴权、请求签名和日志追踪",
            "取消声纹确认，直接让大模型判断用户是否可信",
            "对异常请求建立限流、熔断和告警机制",
          ],
        },
      ],
    },
  ],
  codeProblems: [
    {
      id: "device_ai_scheduling",
      title: "题目 A：设备 AI 请求调度",
      difficulty: "极难",
      body: [
        [
          "题目描述",
          "有 n 个设备请求云端 AI 服务。第 i 个请求属于设备 deviceId，参数为到达时间 ai、处理耗时 ti、截止时间 di。\n\n云端有 k 个并行通道，每个通道同一时间只能处理一个请求。请求不可中断。\n\n约束：\n1. 同一设备的请求必须按到达时间顺序处理。\n2. 同一设备相邻两次请求的开始时间至少间隔 g。\n3. 每次通道空闲时，必须从当前可处理请求中选择截止时间最早的请求；若截止时间相同，选到达时间更早者。\n\n请模拟调度。若所有请求都能在截止时间前完成，输出全部完成时间；否则输出 -1。",
        ],
        ["输入格式", "第一行：n k g\n接下来 n 行：deviceId ai ti di"],
        ["输出格式", "一行整数，表示全部完成时间；无法满足则输出 -1。"],
        ["输入样例 1", "6 2 2\n1 0 4 10\n2 1 3 8\n1 2 2 12\n3 3 5 14\n2 6 2 13\n1 7 3 18"],
        ["输出样例 1", "11"],
        ["输入样例 2", "4 1 3\n1 0 5 5\n1 1 2 8\n2 2 4 9\n3 3 2 12"],
        ["输出样例 2", "-1"],
        [
          "数据范围",
          "1 ≤ n, k ≤ 2 × 10^5\n1 ≤ deviceId ≤ 2 × 10^5\n0 ≤ ai, g ≤ 10^9\n1 ≤ ti ≤ 10^9\n1 ≤ di ≤ 10^18\n请求不保证按时间排序。",
        ],
      ],
    },
    {
      id: "free_pass_checkpoint",
      title: "题目 B：一次免费通行",
      difficulty: "极难",
      body: [
        [
          "题目描述",
          "给定 n 个点、m 条有向边，每条边有通行时间 w。你需要从 s 到 t，并且路径必须经过至少一个检查点。\n\n你有一次免费通行机会，可将路径中的一条边费用变为 0。但这次机会只能在“第一次经过检查点之后”使用。\n\n求满足条件的最短时间；若不存在合法路径，输出 -1。",
        ],
        ["输入格式", "第一行：n m s t p\n第二行：p 个检查点编号\n接下来 m 行：u v w"],
        ["输出格式", "一行整数，表示最短时间；不存在则输出 -1。"],
        ["输入样例 1", "5 6 1 5 1\n3\n1 2 5\n2 3 1\n3 5 100\n1 4 2\n4 5 2\n3 4 3"],
        ["输出样例 1", "6"],
        [
          "样例解释",
          "路径 1 -> 2 -> 3 -> 5 经过检查点 3。免费机会只能在经过检查点后使用，因此可免费边 3 -> 5，总时间为 5 + 1 + 0 = 6。",
        ],
        ["输入样例 2", "4 3 1 4 1\n3\n1 2 2\n2 4 2\n1 3 10"],
        ["输出样例 2", "-1"],
        [
          "数据范围",
          "1 ≤ n ≤ 2 × 10^5\n0 ≤ m ≤ 2 × 10^5\n1 ≤ p ≤ n\n1 ≤ w ≤ 10^9\n检查点编号互不相同。",
        ],
      ],
    },
  ],
  answerKey: {
    single_1: { type: "single", answer: "B", score: 5, title: "RAG 语义召回" },
    single_3: { type: "single", answer: "C", score: 5, title: "声纹评估指标" },
    single_4: { type: "single", answer: "A", score: 5, title: "大模型推理指标" },
    single_5: { type: "single", answer: "C", score: 5, title: "硬件接入 AI API" },
    multi_1: { type: "multiple", answer: ["A", "B", "C", "D"], score: 8, title: "产品知识库建设" },
    multi_2: { type: "multiple", answer: ["A", "B", "C", "E"], score: 8, title: "垂直领域知识库" },
    multi_3: { type: "multiple", answer: ["A", "B", "C", "D"], score: 8, title: "生产部署监控" },
    scenario_rag: { type: "multiple", answer: ["B", "C"], score: 13, title: "RAG 故障定位" },
    scenario_hardware_ai: { type: "multiple", answer: ["A", "B", "D"], score: 13, title: "硬件接入大模型 API 风险排查" },
  },
  codeProblemMeta: {
    device_ai_scheduling: "题目 A：设备 AI 请求调度",
    free_pass_checkpoint: "题目 B：一次免费通行",
  },
  codeProblemTests: {
    device_ai_scheduling: [
      {
        name: "样例 1",
        input: "6 2 2\n1 0 4 10\n2 1 3 8\n1 2 2 12\n3 3 5 14\n2 6 2 13\n1 7 3 18\n",
        output: "11",
      },
      {
        name: "样例 2",
        input: "4 1 3\n1 0 5 5\n1 1 2 8\n2 2 4 9\n3 3 2 12\n",
        output: "-1",
      },
    ],
    free_pass_checkpoint: [
      {
        name: "样例 1",
        input: "5 6 1 5 1\n3\n1 2 5\n2 3 1\n3 5 100\n1 4 2\n4 5 2\n3 4 3\n",
        output: "6",
      },
      {
        name: "样例 2",
        input: "4 3 1 4 1\n3\n1 2 2\n2 4 2\n1 3 10\n",
        output: "-1",
      },
    ],
  },
};
