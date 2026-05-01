import { Server as SocketBE, ServerEvent, World, Agent } from "socket-be";
import { randomUUID } from "crypto";
import * as http from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  ConnectedPlayer,
  ToolCallResult,
} from "./types";

// Advanced Building ツール
import { BuildCubeTool } from "./tools/advanced/building/build-cube";
import { BuildLineTool } from "./tools/advanced/building/build-line";
import { BuildSphereTool } from "./tools/advanced/building/build-sphere";
import { BuildParaboloidTool } from "./tools/advanced/building/build-paraboloid";
import { BuildHyperboloidTool } from "./tools/advanced/building/build-hyperboloid";
import { BuildCylinderTool } from "./tools/advanced/building/build-cylinder";
import { BuildTorusTool } from "./tools/advanced/building/build-torus";
import { BuildHelixTool } from "./tools/advanced/building/build-helix";
import { BuildEllipsoidTool } from "./tools/advanced/building/build-ellipsoid";
import { BuildRotateTool } from "./tools/advanced/building/build-rotate";
import { BuildTransformTool } from "./tools/advanced/building/build-transform";
import { BuildBezierTool } from "./tools/advanced/building/build-bezier";

// Socket-BE Core API ツール（推奨）
import { WorldTool } from "./tools/core/world";
import { PlayerTool } from "./tools/core/player";
import { BlocksTool } from "./tools/core/blocks";
import { SystemTool } from "./tools/core/system";
import { CameraTool } from "./tools/core/camera";
import { SequenceTool } from "./tools/core/sequence";
import { MinecraftWikiTool } from "./tools/core/minecraft-wiki";

import { BaseTool } from "./tools/base/tool";
import { initializeLocale, SupportedLocale } from "./utils/i18n/locale-manager";
import {
  optimizeBuildResult,
  optimizeCommandResult,
  checkResponseSize,
} from "./utils/token-optimizer";
import { SchemaToZodConverter } from "./utils/schema-converter";
import { enrichErrorWithHints } from "./utils/error-hints";

const MAX_EVENT_HISTORY = 100;
const OBSERVED_EVENT_NAMES = [
  "PlayerJoin",
  "PlayerLeave",
  "PlayerChat",
  "BlockBroken",
  "BlockPlaced",
  "ItemAcquired",
  "PlayerTeleported",
] as const;

type ObservedEventName = typeof OBSERVED_EVENT_NAMES[number];

interface MinecraftEventRecord {
  id: string;
  type: ObservedEventName;
  timestamp: string;
  world?: string | null;
  player?: string | null;
  data: Record<string, any>;
}

/**
 * Minecraft Bedrock Edition用MCPサーバー
 *
 * WebSocket接続を通じてMinecraft Bedrock Editionを制御し、
 * MCP（Model Context Protocol）プロトコルを実装して
 * MCP-compatible clientsとの統合を提供します。
 *
 * @description
 * このサーバーは以下の機能を提供します：
 * - WebSocket経由でのMinecraft Bedrock Edition接続
 * - MCP 2.0プロトコル準拠のAIクライアント統合
 * - 15種類の階層化ツール（基本操作・複合操作）
 * - プレイヤー、エージェント、ワールド、建築制御
 *
 * @example
 * ```typescript
 * // サーバーの起動
 * const server = new MinecraftMCPServer();
 * server.start(8001);
 *
 * // Minecraftから接続: /connect localhost:8001/ws
 * ```
 *
 * @since 1.0.0
 * @author mcbk-mcp contributors
 * @see {@link https://modelcontextprotocol.io/} MCP Protocol
 */
export class MinecraftMCPServer {
  private connectedPlayer: ConnectedPlayer | null = null;
  private socketBE: SocketBE | null = null;
  private tools: BaseTool[] = [];
  private currentWorld: World | null = null;
  private currentAgent: Agent | null = null;
  private mcpServer: McpServer;
  private eventHistory: MinecraftEventRecord[] = [];

  constructor() {
    // MCP公式SDKのサーバーを初期化
    this.mcpServer = new McpServer(
      {
        name: "minecraft-bedrock-education-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
  }

  /**
   * MCPサーバーを起動します
   *
   * WebSocketサーバーとMCPインターフェースを初期化し、
   * Minecraftクライアントとの接続を待機します。
   *
   * @param port - WebSocketサーバーのポート番号（デフォルト: 8001）
   * @throws WebSocketサーバーの起動に失敗した場合
   *
   * @example
   * ```typescript
   * const server = new MinecraftMCPServer();
   * server.start(8001); // ポート8001で起動
   *
   * // Minecraftから接続:
   * // /connect localhost:8001/ws
   * ```
   */
  public async start(port: number = 8001, locale?: SupportedLocale): Promise<void> {
    // 言語設定を初期化
    initializeLocale(locale);

    // MCP及びツールの初期化
    await this.setupMCPServer();

    // Socket-BEサーバーの起動
    this.setupSocketBEServer(port);

    // イベントハンドラーの登録
    this.setupEventHandlers();
  }

  /**
   * MCPサーバーとツールを初期化
   * @private
   */
  private async setupMCPServer(): Promise<void> {
    // ツールの初期化
    this.initializeTools();

    // 基本ツールの登録
    this.registerBasicTools();

    // モジュラーツールの登録
    this.registerModularTools();

    // MCP Stdio Transportに接続
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
  }

  /**
   * Socket-BEサーバーを起動
   * @private
   */
  private setupSocketBEServer(port: number): void {
    // Socket-BE Minecraftサーバーを起動
    this.socketBE = new SocketBE({ port });

    // MCPモードでない場合のみstderrにログ出力
    if (process.stdin.isTTY !== false) {
      console.error(`[MC AI Bot] Starting Minecraft WebSocket server on port ${port}.`);
      console.error(`[MC AI Bot] Connect from Minecraft with: /connect localhost:${port}/ws`);
    }
  }

  /**
   * Socket-BEイベントハンドラーを登録
   * @private
   */
  private setupEventHandlers(): void {
    if (!this.socketBE) return;

    this.socketBE.on(ServerEvent.Open, () => {
      this.handleServerOpen();
    });

    this.socketBE.on(ServerEvent.PlayerJoin, async (ev: any) => {
      await this.handlePlayerJoin(ev);
    });

    this.socketBE.on(ServerEvent.PlayerLeave, (ev: any) => {
      this.handlePlayerLeave(ev);
    });

    const observedEvents: Array<[ServerEvent, ObservedEventName]> = [
      [ServerEvent.PlayerChat, "PlayerChat"],
      [ServerEvent.BlockBroken, "BlockBroken"],
      [ServerEvent.BlockPlaced, "BlockPlaced"],
      [ServerEvent.ItemAcquired, "ItemAcquired"],
      [ServerEvent.PlayerTeleported, "PlayerTeleported"],
    ];

    observedEvents.forEach(([serverEvent, eventName]) => {
      (this.socketBE as any)?.on(serverEvent, (ev: any) => {
        this.recordMinecraftEvent(eventName, ev);
      });
    });
  }

  /**
   * サーバーOpen時の処理
   * @private
   */
  private handleServerOpen(): void {
    if (process.stdin.isTTY !== false) {
      console.error("[MC AI Bot] WebSocket server started.");
    }

    // 10秒後に強制的にワールドとエージェントを設定
    this.scheduleWorldInitialization(10000);

    // 定期的なワールドチェック（30秒ごと）
    this.startPeriodicWorldCheck(30000);
  }

  /**
   * ワールド初期化をスケジュール
   * @private
   */
  private scheduleWorldInitialization(delayMs: number): void {
    setTimeout(async () => {
      try {
        const worlds = this.socketBE?.worlds;
        if (worlds && worlds instanceof Map && worlds.size > 0) {
          await this.initializeWorld(Array.from(worlds.values())[0]);
          await this.sendWorldMessage("§a[MC AI Bot] is online.");
        }
      } catch (error) {
        // 強制設定失敗は無視してサーバー継続
      }
    }, delayMs);
  }

  /**
   * 定期的なワールドチェックを開始
   * @private
   */
  private startPeriodicWorldCheck(intervalMs: number): void {
    setInterval(async () => {
      if (!this.currentWorld && this.socketBE) {
        const worlds = this.socketBE.worlds;
        if (worlds instanceof Map && worlds.size > 0) {
          await this.initializeWorld(Array.from(worlds.values())[0]);
          await this.sendWorldMessage("§a[MC AI Bot] is online.");
        }
      }
    }, intervalMs);
  }

  /**
   * ワールドとエージェントを初期化し、ツールに設定
   * @private
   */
  private async initializeWorld(world: World): Promise<void> {
    this.currentWorld = world;

    // Keep the Education Agent disabled by default. This server should connect
    // quietly and wait for explicit instructions.
    this.currentAgent = null;

    // 仮のプレイヤー情報を設定
    if (!this.connectedPlayer) {
      this.connectedPlayer = {
        ws: null,
        name: "MinecraftPlayer",
        id: randomUUID(),
      };
    }

    // 全ツールにSocket-BEインスタンスを設定
    this.updateToolsWithWorldInstances();
  }

  /**
   * 全ツールにワールドとエージェントを設定
   * @private
   */
  private updateToolsWithWorldInstances(): void {
    this.tools.forEach((tool) => {
      tool.setSocketBEInstances(this.currentWorld, this.currentAgent);
    });
  }

  /**
   * ワールドにメッセージを送信（エラー無視）
   * @private
   */
  private async sendWorldMessage(message: string): Promise<void> {
    try {
      await this.currentWorld?.sendMessage(message);
    } catch (messageError) {
      // メッセージ送信失敗は無視
    }
  }

  /**
   * プレイヤー参加時の処理
   * @private
   */
  private async handlePlayerJoin(ev: any): Promise<void> {
    if (process.stdin.isTTY !== false) {
      console.error(`[MC AI Bot] Player joined: ${ev.player.name}`);
    }

    this.recordMinecraftEvent("PlayerJoin", ev);

    // Minecraft側に参加確認メッセージを送信
    await this.sendWorldMessage(
      `§b[MC AI Bot] §f${ev.player.name} connected.`
    );

    this.connectedPlayer = {
      ws: null, // SocketBEではws直接アクセス不要
      name: ev.player.name || "unknown",
      id: randomUUID(),
    };

    this.currentWorld = ev.world;

    // Do not spawn the Education Agent when a player connects.
    this.currentAgent = null;

    // 全ツールのSocket-BEインスタンスを更新
    this.updateToolsWithWorldInstances();
  }

  /**
   * プレイヤー退出時の処理
   * @private
   */
  private handlePlayerLeave(ev: any): void {
    if (process.stdin.isTTY !== false) {
      console.error(`[MC AI Bot] Player left: ${ev.player.name}`);
    }

    this.recordMinecraftEvent("PlayerLeave", ev);

    this.connectedPlayer = null;
    this.currentWorld = null;
    this.currentAgent = null;

    // 全ツールのSocket-BEインスタンスをクリア
    this.tools.forEach((tool) => {
      tool.setSocketBEInstances(null, null);
    });
  }

  /**
   * 利用可能なツールを初期化します
   *
   * Level 1（基本操作）とLevel 2（複合操作）のツールを登録し、
   * 各ツールにコマンド実行関数を注入します。
   *
   * @internal
   */
  private initializeTools(): void {
    this.tools = [
      // Socket-BE Core API ツール（推奨 - シンプルでAI使いやすい）
      new WorldTool(),
      new PlayerTool(),
      new BlocksTool(),
      new SystemTool(),
      new CameraTool(),
      new SequenceTool(),
      new MinecraftWikiTool(),

      // Advanced Building ツール（高レベル建築機能）
      new BuildCubeTool(), // ✅ 完全動作
      new BuildLineTool(), // ✅ 完全動作
      new BuildSphereTool(), // ✅ 完全動作
      new BuildCylinderTool(), // ✅ 修正済み
      new BuildParaboloidTool(), // ✅ 基本動作
      new BuildHyperboloidTool(), // ✅ 基本動作
      new BuildRotateTool(), // ✅ 基本動作
      new BuildTransformTool(), // ✅ 基本動作
      new BuildTorusTool(), // ✅ 修正完了
      new BuildHelixTool(), // ✅ 修正完了
      new BuildEllipsoidTool(), // ✅ 修正完了
      new BuildBezierTool(), // ✅ 新規追加（可変制御点ベジェ曲線）
    ];

    // 全ツールにコマンド実行関数とSocket-BEインスタンスを設定
    const commandExecutor = async (
      command: string
    ): Promise<ToolCallResult> => {
      return this.executeCommand(command);
    };

    this.tools.forEach((tool) => {
      tool.setCommandExecutor(commandExecutor);
      tool.setSocketBEInstances(this.currentWorld, this.currentAgent);
    });

    // SequenceToolにツールレジストリを設定
    const sequenceTool = this.tools.find(
      (tool) => tool.name === "sequence"
    ) as SequenceTool;
    if (sequenceTool) {
      const toolRegistry = new Map<string, BaseTool>();
      this.tools.forEach((tool) => {
        toolRegistry.set(tool.name, tool);
      });
      sequenceTool.setToolRegistry(toolRegistry);
    }
  }

  /**
   * MCP SDKに基本ツールを登録
   */
  private registerBasicTools(): void {
    this.mcpServer.registerTool(
      "events",
      {
        title: "Minecraft Events",
        description:
          "Inspect the recent Minecraft event history captured by the server. Useful for understanding what just happened in the world, such as chat messages, placed/broken blocks, acquired items, and teleports.",
        inputSchema: {
          action: z
            .enum(["list_supported", "recent", "clear"])
            .describe("Action to run: list_supported, recent, or clear"),
          type: z
            .enum(OBSERVED_EVENT_NAMES)
            .optional()
            .describe("Optional event type filter for recent events"),
          limit: z
            .number()
            .int()
            .min(1)
            .max(MAX_EVENT_HISTORY)
            .optional()
            .describe("Maximum number of events to return, from 1 to 100"),
        },
      },
      async ({
        action,
        type,
        limit,
      }: {
        action: "list_supported" | "recent" | "clear";
        type?: ObservedEventName;
        limit?: number;
      }) => {
        if (action === "list_supported") {
          return {
            content: [
              {
                type: "text",
                text: `Supported event types:\n${OBSERVED_EVENT_NAMES.map((name) => `- ${name}`).join("\n")}`,
              },
            ],
          };
        }

        if (action === "clear") {
          const cleared = this.eventHistory.length;
          this.eventHistory = [];
          return {
            content: [
              {
                type: "text",
                text: `Cleared ${cleared} recorded Minecraft event(s).`,
              },
            ],
          };
        }

        const events = this.getRecentMinecraftEvents(type, limit);
        const responseText =
          events.length > 0
            ? `Recent Minecraft events:\n${JSON.stringify(events, null, 2)}`
            : type
              ? `No recent Minecraft events found for ${type}.`
              : "No recent Minecraft events recorded.";

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      }
    );

    // send_message ツール
    this.mcpServer.registerTool(
      "send_message",
      {
        title: "Send Message",
        description:
          "Send a chat message to the connected Minecraft player. ALWAYS provide a message parameter. Use this to communicate with the player about build progress or instructions.",
        inputSchema: {
          message: z
            .string()
            .describe(
              "The text message to send to the player (REQUIRED - never call this without a message)"
            ),
        },
      },
      async ({ message }: { message: string }) => {
        const result = await this.sendMessage(message || "Hello from MCP server!");

        let responseText: string;
        if (result.success) {
          responseText = result.message || "Message sent successfully";
        } else {
          // エラーメッセージにヒントを追加
          const errorMsg = result.message || "Failed to send message";
          responseText = `❌ ${enrichErrorWithHints(errorMsg)}`;
        }

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      }
    );

    // execute_command ツール
    this.mcpServer.registerTool(
      "execute_command",
      {
        title: "Execute Command",
        description: "Execute a Minecraft command",
        inputSchema: {
          command: z.string().describe("The Minecraft command to execute"),
        },
      },
      async ({ command }: { command: string }) => {
        const result = await this.executeCommand(command);

        // トークン最適化: コマンド結果を要約
        const optimized = optimizeCommandResult(result.data);

        let responseText: string;
        if (result.success) {
          responseText = `✅ ${optimized.summary}`;
          if (optimized.details) {
            responseText += `\n\n${JSON.stringify(optimized.details, null, 2)}`;
          }
        } else {
          // エラーメッセージにヒントを追加
          const errorMsg = result.message || "Command execution failed";
          const enrichedError = enrichErrorWithHints(errorMsg);
          responseText = `❌ ${enrichedError}`;
        }

        // レスポンスサイズチェック
        const sizeWarning = checkResponseSize(responseText);
        if (sizeWarning) {
          responseText += `\n\n${sizeWarning}`;
        }

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      }
    );
  }

  /**
   * MCP SDKにモジュラーツールを登録
   */
  private registerModularTools(): void {
    const schemaConverter = new SchemaToZodConverter();

    this.tools.forEach((tool) => {
      // inputSchemaをZod形式に変換（SchemaToZodConverterを使用）
      const zodSchema = schemaConverter.convert(tool.inputSchema);

      // ツールを登録
      this.mcpServer.registerTool(
        tool.name,
        {
          title: tool.name,
          description: tool.description,
          inputSchema: zodSchema,
        },
        async (args: any) => {
          try {
            const result = await tool.execute(args);

            let responseText: string;

            if (result.success) {
              // 建築ツールの場合は最適化
              if (tool.name.startsWith('build_')) {
                const optimized = optimizeBuildResult(result);
                responseText = `✅ ${optimized.message}`;
                if (optimized.summary) {
                  responseText += `\n\n📊 Summary:\n${JSON.stringify(optimized.summary, null, 2)}`;
                }
              } else {
                // 通常ツールの場合
                responseText = result.message || `Tool ${tool.name} executed successfully`;
                if (result.data) {
                  // データサイズチェック
                  const dataStr = JSON.stringify(result.data, null, 2);
                  const sizeWarning = checkResponseSize(dataStr);

                  if (sizeWarning) {
                    // 大きすぎる場合はデータタイプのみ表示
                    responseText += `\n\n${sizeWarning}`;
                    responseText += `\nData type: ${Array.isArray(result.data) ? `Array[${result.data.length}]` : typeof result.data}`;
                  } else {
                    responseText += `\n\nData: ${dataStr}`;
                  }
                }
              }
            } else {
              // エラーメッセージにヒントを追加
              const errorMsg = result.message || "Tool execution failed";
              const enrichedError = enrichErrorWithHints(errorMsg);
              responseText = `❌ ${enrichedError}`;
              if (result.data) {
                responseText += `\n\nDetails:\n${JSON.stringify(result.data, null, 2)}`;
              }
            }

            return {
              content: [
                {
                  type: "text",
                  text: responseText,
                },
              ],
            };
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;

            const exceptionMessage = `Tool execution failed with exception: ${errorMsg}${errorStack ? `\n\nStack trace:\n${errorStack}` : ""}`;

            return {
              content: [
                {
                  type: "text",
                  text: `❌ ${exceptionMessage}`,
                },
              ],
            };
          }
        }
      );
    });
  }

  private lastCommandResponse: any = null;

  /**
   * 接続中のMinecraftプレイヤーにメッセージを送信します
   *
   * @param text - 送信するメッセージテキスト
   * @returns 送信結果
   *
   * @example
   * ```typescript
   * const result = server.sendMessage("Hello, Minecraft!");
   * if (result.success) {
   *   console.log("メッセージ送信成功");
   * }
   * ```
   */
  public async sendMessage(text: string): Promise<ToolCallResult> {
    if (!this.currentWorld) {
      if (process.stdin.isTTY !== false) {
        console.error("[MC AI Bot] Error: no player is connected.");
      }
      return { success: false, message: "No player connected" };
    }

    try {
      if (process.stdin.isTTY !== false) {
        console.error(`[MC AI Bot] Sending message: ${text}`);
      }

      await this.currentWorld.sendMessage(text);
      return { success: true, message: "Message sent successfully" };
    } catch (error) {
      if (process.stdin.isTTY !== false) {
        console.error("[MC AI Bot] Message send error:", error);
      }
      return { success: false, message: `Failed to send message: ${error}` };
    }
  }

  /**
   * Minecraftコマンドを実行します
   *
   * @param command - 実行するMinecraftコマンド（"/"プレフィックスなし）
   * @returns コマンド実行結果
   *
   * @example
   * ```typescript
   * // プレイヤーをテレポート
   * server.executeCommand("tp @p 100 64 200");
   *
   * // ブロックを設置
   * server.executeCommand("setblock 0 64 0 minecraft:stone");
   * ```
   */
  public async executeCommand(command: string): Promise<ToolCallResult> {
    if (!this.currentWorld) {
      return { success: false, message: "No player connected" };
    }

    try {
      const result = await this.currentWorld.runCommand(command);

      // レスポンスをlastCommandResponseに保存（位置情報取得などで使用）
      this.lastCommandResponse = result;

      return {
        success: true,
        message: "Command executed successfully",
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        message: `Command execution failed: ${error}`,
      };
    }
  }

  /**
   * 最新のコマンドレスポンスを取得します（位置情報など）
   */
  public getLastCommandResponse(): any {
    return this.lastCommandResponse;
  }

  /**
   * Lightweight status snapshot for local automation wrappers.
   */
  public getConnectionStatus(): any {
    return {
      connected: !!this.currentWorld,
      player: this.connectedPlayer?.name || null,
      world: this.currentWorld
        ? {
            name: this.currentWorld.name,
            connectedAt: this.currentWorld.connectedAt,
            averagePing: this.currentWorld.averagePing,
            maxPlayers: this.currentWorld.maxPlayers,
            isValid: this.currentWorld.isValid,
          }
        : null,
      agentAvailable: !!this.currentAgent,
      recordedEvents: this.eventHistory.length,
    };
  }

  public getRecentMinecraftEvents(
    type?: ObservedEventName,
    limit: number = 20
  ): MinecraftEventRecord[] {
    const cappedLimit = Math.min(Math.max(limit || 20, 1), MAX_EVENT_HISTORY);
    const events = type
      ? this.eventHistory.filter((event) => event.type === type)
      : this.eventHistory;

    return events.slice(-cappedLimit).reverse();
  }

  private recordMinecraftEvent(type: ObservedEventName, ev: any): void {
    const record: MinecraftEventRecord = {
      id: randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      world: ev?.world?.name || this.currentWorld?.name || null,
      player: this.extractPlayerName(ev?.player || ev?.sender),
      data: this.extractEventData(type, ev),
    };

    this.eventHistory.push(record);
    if (this.eventHistory.length > MAX_EVENT_HISTORY) {
      this.eventHistory.splice(0, this.eventHistory.length - MAX_EVENT_HISTORY);
    }
  }

  private extractEventData(
    type: ObservedEventName,
    ev: any
  ): Record<string, any> {
    switch (type) {
      case "PlayerJoin":
      case "PlayerLeave":
        return {
          player: this.extractPlayerName(ev?.player),
        };
      case "PlayerChat":
        return {
          sender: this.extractPlayerName(ev?.sender),
          message: ev?.message,
        };
      case "BlockBroken":
        return {
          player: this.extractPlayerName(ev?.player),
          block: this.extractBlockId(ev?.brokenBlockType),
          destructionMethod: ev?.destructionMethod,
          tool: this.extractItemStack(ev?.itemStackBeforeBreak),
        };
      case "BlockPlaced":
        return {
          player: this.extractPlayerName(ev?.player),
          block: this.extractBlockId(ev?.placedBlockType),
          placedUnderwater: ev?.placedUnderwater,
          placementMethod: ev?.placementMethod,
          item: this.extractItemStack(ev?.itemStackBeforePlace),
        };
      case "ItemAcquired":
        return {
          player: this.extractPlayerName(ev?.player),
          item: this.extractItemType(ev?.itemType),
          amount: ev?.acquiredAmount,
          acquisitionMethod: ev?.acquisitionMethod,
        };
      case "PlayerTeleported":
        return {
          player: this.extractPlayerName(ev?.player),
          cause: ev?.cause,
          metersTravelled: ev?.metersTravelled,
          rawItemId: ev?.rawItemId,
        };
      default:
        return {};
    }
  }

  private extractPlayerName(player: any): string | null {
    return player?.name || player?.rawName || null;
  }

  private extractBlockId(block: any): string | null {
    return block?.id || block?.typeId || null;
  }

  private extractItemType(itemType: any): string | null {
    return itemType?.id || itemType?.typeId || null;
  }

  private extractItemStack(itemStack: any): Record<string, any> | null {
    if (!itemStack) return null;

    return {
      type: itemStack.typeId || itemStack.type?.id || null,
      amount: itemStack.amount,
      data: itemStack.data,
    };
  }
}

// サーバーを開始
const server = new MinecraftMCPServer();

// ポート番号をコマンドライン引数から取得
const getPort = (): number => {
  // コマンドライン引数から取得 (--port=8002)
  const portArg = process.argv.find((arg) => arg.startsWith("--port="));
  if (portArg) {
    const port = parseInt(portArg.split("=")[1]);
    if (!isNaN(port) && port > 0 && port <= 65535) {
      return port;
    }
  }

  // デフォルト値
  return 8001;
};

// ローカルHTTP制御ポートをコマンドライン引数から取得 (--http-port=3001)
const getHttpPort = (): number | undefined => {
  const portArg = process.argv.find((arg) => arg.startsWith("--http-port="));
  if (!portArg) return undefined;

  const port = parseInt(portArg.split("=")[1]);
  if (!isNaN(port) && port > 0 && port <= 65535) {
    return port;
  }

  return undefined;
};

// 言語設定をコマンドライン引数から取得
const getLocale = (): SupportedLocale | undefined => {
  // コマンドライン引数から取得 (--lang=ja または --lang=en)
  const langArg = process.argv.find((arg) => arg.startsWith("--lang="));
  if (langArg) {
    const lang = langArg.split("=")[1];
    if (lang === "ja" || lang === "en") {
      return lang;
    }
  }

  // デフォルトは自動検出（undefined）
  return undefined;
};

const port = getPort();
const locale = getLocale();
const httpPort = getHttpPort();

server.start(port, locale).then(() => {
  if (httpPort) {
    startLocalHttpApi(server, httpPort);
  }
}).catch((error) => {
  console.error("Failed to start Minecraft MCP server:", error);
  process.exit(1);
});

process.on("SIGINT", () => {
  process.exit(0);
});

function startLocalHttpApi(server: MinecraftMCPServer, port: number): void {
  const api = http.createServer(async (req, res) => {
    try {
      setJsonHeaders(res);

      if (req.method === "GET" && req.url === "/status") {
        res.end(JSON.stringify(server.getConnectionStatus()));
        return;
      }

      if (req.method === "POST" && req.url === "/message") {
        const body = await readJsonBody(req);
        const result = await server.sendMessage(String(body.message || ""));
        res.end(JSON.stringify(result));
        return;
      }

      if (req.method === "POST" && req.url === "/command") {
        const body = await readJsonBody(req);
        const rawCommand = String(body.command || "");
        const command = rawCommand.startsWith("/") ? rawCommand.slice(1) : rawCommand;
        const result = await server.executeCommand(command);
        res.end(JSON.stringify(result));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ success: false, message: "Not found" }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  });

  api.listen(port, "127.0.0.1", () => {
    console.error(`Local HTTP control API listening on http://127.0.0.1:${port}`);
    console.error("Endpoints: GET /status, POST /message, POST /command");
  });
}

function setJsonHeaders(res: http.ServerResponse): void {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1");
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!data.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}
