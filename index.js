#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Parse ScrapingBee API error response to extract detailed error information
 * @param {number} statusCode - HTTP status code
 * @param {string} responseText - Raw response text from API
 * @param {string} url - The URL being scraped
 * @returns {object} Structured error information
 */
function parseScrapingBeeError(statusCode, responseText, url) {
  const errorInfo = {
    statusCode,
    statusText: getHttpStatusText(statusCode),
    rawResponse: responseText?.substring(0, 1000) || 'No response body',
    url,
    timestamp: new Date().toISOString(),
    possibleCauses: [],
    suggestions: []
  };

  // Try to parse JSON error response
  try {
    const parsed = JSON.parse(responseText);
    if (parsed.error) errorInfo.apiError = parsed.error;
    if (parsed.message) errorInfo.apiMessage = parsed.message;
  } catch (e) {
    // Response is not JSON, keep raw text
  }

  // Add context based on status code
  switch (statusCode) {
    case 400:
      errorInfo.possibleCauses = [
        'Invalid URL format or encoding',
        'Malformed extract_rules JSON',
        'Invalid parameter combination',
        'Missing required parameters'
      ];
      errorInfo.suggestions = [
        'Ensure URL is properly encoded',
        'Validate extract_rules JSON syntax',
        'Check parameter types match schema'
      ];
      break;
    case 401:
      errorInfo.possibleCauses = [
        'Invalid or missing API key',
        'API key has expired',
        'API key does not have required permissions'
      ];
      errorInfo.suggestions = [
        'Verify SCRAPINGBEE_API_KEY environment variable is set',
        'Check API key is valid at scrapingbee.com dashboard'
      ];
      break;
    case 402:
      errorInfo.possibleCauses = [
        'Insufficient API credits',
        'Account credit limit reached'
      ];
      errorInfo.suggestions = [
        'Check your credit balance at scrapingbee.com',
        'Purchase more credits or upgrade plan'
      ];
      break;
    case 403:
      errorInfo.possibleCauses = [
        'Access forbidden to target URL',
        'Target site blocking requests',
        'Geographic restrictions'
      ];
      errorInfo.suggestions = [
        'Try premium_proxy=true for better success rate',
        'Use stealth_proxy=true for heavily protected sites',
        'Try different country_code'
      ];
      break;
    case 408:
    case 504:
      errorInfo.possibleCauses = [
        'Request timed out',
        'Target site too slow to respond',
        'Complex JavaScript taking too long'
      ];
      errorInfo.suggestions = [
        'Increase wait parameter',
        'Use wait_for with specific selector',
        'Try without render_js if not needed'
      ];
      break;
    case 429:
      errorInfo.possibleCauses = [
        'Rate limit exceeded',
        'Too many concurrent requests'
      ];
      errorInfo.suggestions = [
        'Slow down request frequency',
        'Wait before retrying',
        'Check account rate limits'
      ];
      break;
    case 500:
      errorInfo.possibleCauses = [
        'ScrapingBee internal server error',
        'Target site caused server crash',
        'Google scraping without custom_google parameter'
      ];
      errorInfo.suggestions = [
        'For Google URLs, add custom_google=true',
        'Retry request after a few seconds',
        'Try with different proxy settings'
      ];
      if (url?.includes('google.')) {
        errorInfo.suggestions.unshift('CRITICAL: Add custom_google=true for Google domains');
      }
      break;
    case 502:
    case 503:
      errorInfo.possibleCauses = [
        'ScrapingBee service temporarily unavailable',
        'Target site is down',
        'Network connectivity issues'
      ];
      errorInfo.suggestions = [
        'Retry after a short delay',
        'Check ScrapingBee status page',
        'Verify target URL is accessible'
      ];
      break;
    default:
      errorInfo.possibleCauses = ['Unknown error occurred'];
      errorInfo.suggestions = ['Check ScrapingBee documentation for status code ' + statusCode];
  }

  return errorInfo;
}

/**
 * Get human-readable HTTP status text
 */
function getHttpStatusText(code) {
  const statusTexts = {
    400: 'Bad Request',
    401: 'Unauthorized',
    402: 'Payment Required',
    403: 'Forbidden',
    404: 'Not Found',
    408: 'Request Timeout',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout'
  };
  return statusTexts[code] || 'Unknown Status';
}

/**
 * Create a detailed error response for MCP
 */
function createErrorResponse(error, context = {}) {
  const errorDetails = {
    success: false,
    error: error.message || String(error),
    errorType: error.name || 'Error',
    context: {
      ...context,
      timestamp: new Date().toISOString()
    }
  };

  // Add stack trace for debugging (truncated)
  if (error.stack) {
    errorDetails.stackTrace = error.stack.split('\n').slice(0, 5).join('\n');
  }

  // Add cause chain if available
  if (error.cause) {
    errorDetails.cause = error.cause.message || String(error.cause);
  }

  // Classify error type for better AI understanding
  if (error.message?.includes('timeout') || error.code === 'ETIMEDOUT') {
    errorDetails.errorCategory = 'TIMEOUT';
    errorDetails.suggestions = ['Increase timeout', 'Check network connectivity', 'Try with simpler request'];
  } else if (error.message?.includes('ENOTFOUND') || error.message?.includes('ECONNREFUSED')) {
    errorDetails.errorCategory = 'NETWORK';
    errorDetails.suggestions = ['Check internet connection', 'Verify URL is accessible', 'Check DNS resolution'];
  } else if (error.message?.includes('JSON')) {
    errorDetails.errorCategory = 'PARSE_ERROR';
    errorDetails.suggestions = ['Validate JSON syntax', 'Check for special characters', 'Ensure proper escaping'];
  } else if (error.message?.includes('API key')) {
    errorDetails.errorCategory = 'AUTH';
    errorDetails.suggestions = ['Set SCRAPINGBEE_API_KEY environment variable', 'Verify API key is valid'];
  } else {
    errorDetails.errorCategory = 'UNKNOWN';
    errorDetails.suggestions = ['Check parameters', 'Review ScrapingBee documentation', 'Contact support if issue persists'];
  }

  return errorDetails;
}

/**
 * ScrapingBee MCP Server
 * Provides tools for testing web scraping extract rules using the ScrapingBee API
 *
 * Updated to use MCP SDK v1.22.0 API
 */
class ScrapingBeeMcpServer {
  constructor() {
    this.server = new McpServer(
      {
        name: 'scraping-bee-mcp',
        version: '2.2.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();

    // Error handler is on the inner server instance
    this.server.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  setupToolHandlers() {
    // Register tool using the new SDK API with Zod schemas
    this.server.tool(
      'test_extract_rules',
      'Test web scraping extract rules using ScrapingBee API. Extracts structured data from web pages using CSS/XPath selectors.',
      {
        url: z.string().describe('The target page URL to scrape'),
        extract_rules: z.string().describe(
          'JSON-encoded string describing what to extract. Use simple format for single fields: {"title": "h1"}. Use list format for arrays: {"items": {"selector": ".item", "type": "list", "output": {"name": ".name"}}}. IMPORTANT: ScrapingBee uses a LIMITED CSS subset - avoid :nth-of-type(), :nth-child(), :not(), :has() and other pseudo-selectors. Use class names and IDs instead.'
        ),
        js_scenario: z.string().optional().describe(
          'Optional JSON-encoded string. MUST be an object with "instructions" array: {"instructions": [{"wait": 1000}, {"click": ".button"}]}. NEVER pass empty array [] - omit this parameter if no actions needed. Available actions: wait (ms), click (selector), fill (selector+value), scroll_y (pixels), wait_for (selector).'
        ),
        render_js: z.boolean().optional().describe(
          'Enable a headless browser to execute JavaScript before extraction'
        ),
        wait: z.number().int().min(0).max(35000).optional().describe(
          'Fixed delay in milliseconds before returning the response (0-35000)'
        ),
        wait_for: z.string().optional().describe(
          'CSS/XPath selector to wait for before returning'
        ),
        wait_browser: z.enum(['domcontentloaded', 'load', 'networkidle0', 'networkidle2']).optional().describe(
          'Browser event to wait for (e.g., domcontentloaded)'
        ),
        premium_proxy: z.boolean().optional().describe(
          'Use residential proxy for scraper-resistant sites'
        ),
        stealth_proxy: z.boolean().optional().describe(
          'Use stealth proxy for the hardest-to-scrape sites (most expensive option)'
        ),
        country_code: z.string().regex(/^[a-z]{2}$/).optional().describe(
          'Proxy geolocation (e.g., us, de, br)'
        ),
        session_id: z.number().int().optional().describe(
          'Keep the same IP across multiple requests (sticky sessions)'
        ),
        custom_google: z.boolean().optional().describe(
          'Enable Google-specific handling (always true for Google domains)'
        ),
      },
      async (args) => {
        return await this.testExtractRules(args);
      }
    );
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
      const errorDetails = createErrorResponse(error, {
        operation: 'testExtractRules',
        url: args?.url,
        hasExtractRules: !!args?.extract_rules,
        hasJsScenario: !!args?.js_scenario,
        renderJs: args?.render_js,
        premiumProxy: args?.premium_proxy,
        stealthProxy: args?.stealth_proxy
      });

      // Include ScrapingBee-specific error details if available
      if (error.scrapingBeeError) {
        errorDetails.scrapingBeeError = error.scrapingBeeError;
      }

      // Include custom suggestions from the error
      if (error.suggestions) {
        errorDetails.suggestions = error.suggestions;
      }

      // Include category if set on error
      if (error.errorCategory) {
        errorDetails.errorCategory = error.errorCategory;
      }

      // Include applied params for debugging
      if (error.appliedParams) {
        errorDetails.appliedParams = error.appliedParams;
      }

      console.error('[ScrapingBee MCP Error]', JSON.stringify(errorDetails, null, 2));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ...errorDetails,
                message: `ScrapingBee extraction failed: ${error.message}`,
                helpUrl: 'https://www.scrapingbee.com/documentation/',
                troubleshootingUrl: 'https://help.scrapingbee.com/en/article/what-to-do-if-my-request-fails-1jv1rmk/'
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
      const error = new Error('SCRAPINGBEE_API_KEY environment variable is not set');
      error.errorCategory = 'AUTH';
      error.suggestions = [
        'Set the SCRAPINGBEE_API_KEY environment variable',
        'Get your API key from https://app.scrapingbee.com/account',
        'For stdio transport: export SCRAPINGBEE_API_KEY=your_key',
        'For .env file: add SCRAPINGBEE_API_KEY=your_key'
      ];
      throw error;
    }

    const queryParams = new URLSearchParams({
      api_key: apiKey,
      url,
      extract_rules: params.extract_rules,
    });

    // Track which optional params were added for error context
    const appliedParams = { url, hasExtractRules: true };

    if (params.js_scenario) {
      queryParams.append('js_scenario', params.js_scenario);
      appliedParams.hasJsScenario = true;
    }
    if (params.render_js !== undefined) {
      queryParams.append('render_js', params.render_js.toString());
      appliedParams.renderJs = params.render_js;
    }
    if (params.wait !== undefined) {
      queryParams.append('wait', params.wait.toString());
      appliedParams.wait = params.wait;
    }
    if (params.wait_for) {
      queryParams.append('wait_for', params.wait_for);
      appliedParams.waitFor = params.wait_for;
    }
    if (params.wait_browser) {
      queryParams.append('wait_browser', params.wait_browser);
      appliedParams.waitBrowser = params.wait_browser;
    }
    if (params.premium_proxy !== undefined) {
      queryParams.append('premium_proxy', params.premium_proxy.toString());
      appliedParams.premiumProxy = params.premium_proxy;
    }
    if (params.stealth_proxy !== undefined) {
      queryParams.append('stealth_proxy', params.stealth_proxy.toString());
      appliedParams.stealthProxy = params.stealth_proxy;
    }
    if (params.country_code) {
      queryParams.append('country_code', params.country_code);
      appliedParams.countryCode = params.country_code;
    }
    if (params.session_id !== undefined) {
      queryParams.append('session_id', params.session_id.toString());
      appliedParams.sessionId = params.session_id;
    }
    if (params.custom_google !== undefined) {
      queryParams.append('custom_google', params.custom_google.toString());
      appliedParams.customGoogle = params.custom_google;
    }

    const apiUrl = `https://app.scrapingbee.com/api/v1/?${queryParams.toString()}`;

    console.error(`[ScrapingBee] Making API request to URL: ${url}`);

    let response;
    try {
      response = await fetch(apiUrl, {
        signal: AbortSignal.timeout(120000) // 2 minute timeout
      });
    } catch (fetchError) {
      // Handle network-level errors with detailed context
      const error = new Error(`Network error calling ScrapingBee API: ${fetchError.message}`);
      error.errorCategory = fetchError.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK';
      error.originalError = fetchError.message;
      error.targetUrl = url;
      error.appliedParams = appliedParams;
      error.suggestions = fetchError.name === 'TimeoutError'
        ? [
            'The request took longer than 2 minutes',
            'Try with a shorter wait time',
            'Consider simpler extract_rules',
            'Check if target site is responsive'
          ]
        : [
            'Check your internet connection',
            'Verify ScrapingBee API is accessible',
            'Check if there are firewall restrictions'
          ];
      throw error;
    }

    if (!response.ok) {
      const errorText = await response.text();
      const parsedError = parseScrapingBeeError(response.status, errorText, url);

      // Extract ScrapingBee-specific headers if available
      const spbCost = response.headers.get('spb-cost');
      const spbInitialStatus = response.headers.get('spb-initial-status-code');
      const spbResolvedUrl = response.headers.get('spb-resolved-url');

      if (spbCost) parsedError.creditsCost = spbCost;
      if (spbInitialStatus) parsedError.targetSiteStatusCode = spbInitialStatus;
      if (spbResolvedUrl) parsedError.resolvedUrl = spbResolvedUrl;

      parsedError.appliedParams = appliedParams;

      const error = new Error(
        `ScrapingBee API error (HTTP ${response.status} ${parsedError.statusText}): ` +
        `${parsedError.apiError || parsedError.apiMessage || errorText.substring(0, 200)}`
      );
      error.scrapingBeeError = parsedError;
      error.errorCategory = 'API_ERROR';
      throw error;
    }

    // Try to get response headers for context
    const spbCost = response.headers.get('spb-cost');
    if (spbCost) {
      console.error(`[ScrapingBee] Request cost: ${spbCost} credits`);
    }

    try {
      return await response.json();
    } catch (parseError) {
      const rawText = await response.text().catch(() => 'Could not read response body');
      const error = new Error(`Failed to parse ScrapingBee response as JSON: ${parseError.message}`);
      error.errorCategory = 'PARSE_ERROR';
      error.rawResponse = rawText.substring(0, 500);
      error.suggestions = [
        'The API returned non-JSON data',
        'This might indicate an issue with extract_rules',
        'Check if the target page has the expected structure'
      ];
      throw error;
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('ScrapingBee MCP server running on stdio');
  }
}

const server = new ScrapingBeeMcpServer();
server.run().catch(console.error);
