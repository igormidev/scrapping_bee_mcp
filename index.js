#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * ScrapingBee MCP Server
 * Provides tools for testing web scraping extract rules using the ScrapingBee API
 */
class ScrapingBeeMcpServer {
  constructor() {
    this.server = new McpServer(
      {
        name: 'scraping-bee-mcp',
        version: '1.0.7',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'test_extract_rules',
          description:
            'Test web scraping extract rules using ScrapingBee API. ' +
            'Extracts structured data from web pages using CSS/XPath selectors.',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'The target page URL to scrape',
              },
              extract_rules: {
                type: 'string',
                description:
                  'JSON-encoded string describing what to extract ' +
                  '(CSS/XPath selectors, lists, attributes, tables, etc.)',
              },
              js_scenario: {
                type: 'string',
                description:
                  'Optional JSON-encoded string of scripted actions ' +
                  '(click/type/scroll/infinite-scroll/etc.) to run before extraction',
              },
              render_js: {
                type: 'boolean',
                description:
                  'Enable a headless browser to execute JavaScript before extraction',
              },
              wait: {
                type: 'integer',
                description:
                  'Fixed delay in milliseconds before returning the response (0-35000)',
                minimum: 0,
                maximum: 35000,
              },
              wait_for: {
                type: 'string',
                description:
                  'CSS/XPath selector to wait for before returning',
              },
              wait_browser: {
                type: 'string',
                description:
                  'Browser event to wait for (e.g., domcontentloaded)',
                enum: ['domcontentloaded', 'load', 'networkidle0', 'networkidle2'],
              },
              premium_proxy: {
                type: 'boolean',
                description:
                  'Use residential proxy for scraper-resistant sites',
              },
              stealth_proxy: {
                type: 'boolean',
                description:
                  'Use stealth proxy for the hardest-to-scrape sites (most expensive option)',
              },
              country_code: {
                type: 'string',
                description: 'Proxy geolocation (e.g., us, de, br)',
                pattern: '^[a-z]{2}$',
              },
              session_id: {
                type: 'integer',
                description:
                  'Keep the same IP across multiple requests (sticky sessions)',
              },
              custom_google: {
                type: 'boolean',
                description:
                  'Enable Google-specific handling (always true for Google domains)',
              },
            },
            required: ['url', 'extract_rules'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => this.handleToolCall(request)
    );
  }

  async handleToolCall(request) {
    if (request.params.name !== 'test_extract_rules') {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }
    return await this.testExtractRules(request.params.arguments || {});
  }

  async testExtractRules(args) {
    try {
      const { url, extract_rules } = args;

      if (!url || !extract_rules) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error: 'Missing required parameters',
                  message: 'Both url and extract_rules are required',
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      let extractRulesObj;
      try {
        extractRulesObj = JSON.parse(extract_rules);
      } catch (e) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error: `Invalid extract_rules JSON: ${e.message}`,
                  message:
                    'The extract_rules parameter must be a valid JSON string',
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      let jsScenarioObj;
      if (args.js_scenario) {
        try {
          jsScenarioObj = JSON.parse(args.js_scenario);
        } catch (e) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: false,
                    error: `Invalid js_scenario JSON: ${e.message}`,
                    message:
                      'The js_scenario parameter must be a valid JSON string',
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }
      }

      if (args.wait !== undefined && (args.wait < 0 || args.wait > 35000)) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error: 'Invalid wait value',
                  message: 'Wait must be between 0 and 35000 milliseconds',
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      if (args.country_code && !/^[a-z]{2}$/.test(args.country_code)) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error: 'Invalid country_code',
                  message:
                    'Country code must be a 2-letter lowercase code (e.g., us, de, br)',
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      const result = await this.callScrapingBeeApi(url, args);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: result,
                message: 'Data extracted successfully',
                url,
                rules_applied: extractRulesObj,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error.message,
                message:
                  'An unexpected error occurred while processing the request',
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }

  async callScrapingBeeApi(url, params) {
    const apiKey = process.env.SCRAPINGBEE_API_KEY;

    if (!apiKey) {
      throw new Error('SCRAPINGBEE_API_KEY environment variable is not set');
    }

    const queryParams = new URLSearchParams({
      api_key: apiKey,
      url,
      extract_rules: params.extract_rules,
    });

    if (params.js_scenario) {
      queryParams.append('js_scenario', params.js_scenario);
    }
    if (params.render_js !== undefined) {
      queryParams.append('render_js', params.render_js.toString());
    }
    if (params.wait !== undefined) {
      queryParams.append('wait', params.wait.toString());
    }
    if (params.wait_for) {
      queryParams.append('wait_for', params.wait_for);
    }
    if (params.wait_browser) {
      queryParams.append('wait_browser', params.wait_browser);
    }
    if (params.premium_proxy !== undefined) {
      queryParams.append('premium_proxy', params.premium_proxy.toString());
    }
    if (params.stealth_proxy !== undefined) {
      queryParams.append('stealth_proxy', params.stealth_proxy.toString());
    }
    if (params.country_code) {
      queryParams.append('country_code', params.country_code);
    }
    if (params.session_id !== undefined) {
      queryParams.append('session_id', params.session_id.toString());
    }
    if (params.custom_google !== undefined) {
      queryParams.append('custom_google', params.custom_google.toString());
    }

    const apiUrl = `https://app.scrapingbee.com/api/v1/?${queryParams.toString()}`;

    const response = await fetch(apiUrl);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ScrapingBee API error (${response.status}): ${errorText}`);
    }

    return await response.json();
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('ScrapingBee MCP server running on stdio');
  }
}

const server = new ScrapingBeeMcpServer();
server.run().catch(console.error);
