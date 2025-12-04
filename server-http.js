#!/usr/bin/env node

import http from 'http';

const PORT = process.env.PORT || 3000;

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
        'Verify api_key parameter is provided',
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
 * Create a detailed error response for MCP tool calls
 */
function createDetailedErrorResponse(error, context = {}) {
  const errorDetails = {
    success: false,
    error: error.message || String(error),
    errorType: error.name || 'Error',
    errorCategory: error.errorCategory || 'UNKNOWN',
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

  // Include ScrapingBee-specific error details if available
  if (error.scrapingBeeError) {
    errorDetails.scrapingBeeError = error.scrapingBeeError;
  }

  // Include custom suggestions
  if (error.suggestions) {
    errorDetails.suggestions = error.suggestions;
  } else {
    // Generate suggestions based on error type
    if (error.message?.includes('timeout') || error.code === 'ETIMEDOUT') {
      errorDetails.errorCategory = 'TIMEOUT';
      errorDetails.suggestions = ['Increase timeout', 'Check network connectivity', 'Try with simpler request'];
    } else if (error.message?.includes('ENOTFOUND') || error.message?.includes('ECONNREFUSED')) {
      errorDetails.errorCategory = 'NETWORK';
      errorDetails.suggestions = ['Check internet connection', 'Verify URL is accessible', 'Check DNS resolution'];
    } else if (error.message?.includes('JSON')) {
      errorDetails.errorCategory = 'PARSE_ERROR';
      errorDetails.suggestions = ['Validate JSON syntax', 'Check for special characters', 'Ensure proper escaping'];
    } else if (error.message?.includes('API key') || error.message?.includes('api_key')) {
      errorDetails.errorCategory = 'AUTH';
      errorDetails.suggestions = ['Provide api_key parameter', 'Verify API key is valid'];
    } else {
      errorDetails.suggestions = ['Check parameters', 'Review ScrapingBee documentation', 'Contact support if issue persists'];
    }
  }

  return errorDetails;
}

// ScrapingBee API key (can be passed via tool arguments for flexibility)
const DEFAULT_API_KEY = process.env.SCRAPINGBEE_API_KEY || '';

// MCP Protocol version (2025-03-26 spec)
const PROTOCOL_VERSION = '2024-11-05';

// Server info
const SERVER_INFO = {
  name: 'scraping-bee-mcp',
  version: '2.1.0'
};

// Define MCP tool for ScrapingBee extract rules
const tools = [
  {
    name: 'test_extract_rules',
    description: 'Test web scraping extract rules using ScrapingBee API. Extracts structured data from web pages using CSS/XPath selectors. Use this to validate that your CSS selectors work correctly before implementing them in production scraping configurations.',
    inputSchema: {
      type: 'object',
      properties: {
        api_key: {
          type: 'string',
          description: 'Your ScrapingBee API key'
        },
        url: {
          type: 'string',
          description: 'The target page URL to scrape'
        },
        extract_rules: {
          type: 'string',
          description: 'JSON-encoded string describing what to extract. Use simple format for single fields: {"title": "h1"}. Use list format for arrays: {"items": {"selector": ".item", "type": "list", "output": {"name": ".name"}}}. IMPORTANT: ScrapingBee uses a LIMITED CSS subset - avoid :nth-of-type(), :nth-child(), :not(), :has() and other pseudo-selectors. Use class names and IDs instead.'
        },
        js_scenario: {
          type: 'string',
          description: 'Optional JSON-encoded string. MUST be an object with "instructions" array: {"instructions": [{"wait": 1000}, {"click": ".button"}]}. NEVER pass empty array [] - omit this parameter if no actions needed. Available actions: wait (ms), click (selector), fill (selector+value), scroll_y (pixels), wait_for (selector). See https://www.scrapingbee.com/documentation/javascript-scenario/'
        },
        render_js: {
          type: 'boolean',
          description: 'Enable a headless browser to execute JavaScript before extraction (default: true for dynamic pages)'
        },
        wait: {
          type: 'integer',
          description: 'Fixed delay in milliseconds before returning the response (0-35000)'
        },
        wait_for: {
          type: 'string',
          description: 'CSS/XPath selector to wait for before returning'
        },
        wait_browser: {
          type: 'string',
          description: 'Browser event to wait for',
          enum: ['domcontentloaded', 'load', 'networkidle0', 'networkidle2']
        },
        premium_proxy: {
          type: 'boolean',
          description: 'Use residential proxy for scraper-resistant sites (recommended for most sites)'
        },
        stealth_proxy: {
          type: 'boolean',
          description: 'Use stealth proxy for the hardest-to-scrape sites (most expensive option)'
        },
        country_code: {
          type: 'string',
          description: 'Proxy geolocation (e.g., us, de, br)'
        },
        session_id: {
          type: 'integer',
          description: 'Keep the same IP across multiple requests (sticky sessions)'
        },
        custom_google: {
          type: 'boolean',
          description: 'Enable Google-specific handling (always true for Google domains)'
        },
        block_resources: {
          type: 'boolean',
          description: 'Block images, stylesheets, and fonts to speed up page loading'
        },
        block_ads: {
          type: 'boolean',
          description: 'Block ads and trackers'
        },
        json_response: {
          type: 'boolean',
          description: 'Return response as JSON (default: true when using extract_rules)'
        }
      },
      required: ['api_key', 'url', 'extract_rules']
    }
  },
  {
    name: 'get_page_html',
    description: 'Fetch the full HTML content of a web page using ScrapingBee. Useful for inspecting page structure to determine correct CSS selectors.',
    inputSchema: {
      type: 'object',
      properties: {
        api_key: {
          type: 'string',
          description: 'Your ScrapingBee API key'
        },
        url: {
          type: 'string',
          description: 'The target page URL to fetch'
        },
        render_js: {
          type: 'boolean',
          description: 'Enable JavaScript rendering (default: true)'
        },
        wait: {
          type: 'integer',
          description: 'Fixed delay in milliseconds before returning (0-35000)'
        },
        wait_for: {
          type: 'string',
          description: 'CSS/XPath selector to wait for before returning'
        },
        premium_proxy: {
          type: 'boolean',
          description: 'Use residential proxy for scraper-resistant sites'
        },
        return_page_source: {
          type: 'boolean',
          description: 'Return the page source HTML (post-JavaScript execution)'
        }
      },
      required: ['api_key', 'url']
    }
  },
  {
    name: 'get_screenshot',
    description: 'Take a screenshot of a web page using ScrapingBee. Returns base64-encoded image data. Useful for visually debugging page rendering.',
    inputSchema: {
      type: 'object',
      properties: {
        api_key: {
          type: 'string',
          description: 'Your ScrapingBee API key'
        },
        url: {
          type: 'string',
          description: 'The target page URL to screenshot'
        },
        screenshot: {
          type: 'boolean',
          description: 'Take a screenshot (default: true)',
          default: true
        },
        screenshot_full_page: {
          type: 'boolean',
          description: 'Capture full page screenshot instead of viewport only'
        },
        window_width: {
          type: 'integer',
          description: 'Browser window width in pixels (default: 1920)'
        },
        window_height: {
          type: 'integer',
          description: 'Browser window height in pixels (default: 1080)'
        },
        wait: {
          type: 'integer',
          description: 'Fixed delay in milliseconds before taking screenshot'
        },
        wait_for: {
          type: 'string',
          description: 'CSS/XPath selector to wait for before taking screenshot'
        },
        premium_proxy: {
          type: 'boolean',
          description: 'Use residential proxy'
        }
      },
      required: ['api_key', 'url']
    }
  }
];

// Handle JSON-RPC requests
async function handleJsonRpcRequest(request) {
  const { jsonrpc, id, method, params } = request;

  console.log(`[MCP] Handling method: ${method}`);

  switch (method) {
    case 'initialize': {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false }
          },
          serverInfo: SERVER_INFO
        }
      };
    }

    case 'tools/list': {
      return {
        jsonrpc: '2.0',
        id,
        result: { tools }
      };
    }

    case 'tools/call': {
      const { name, arguments: args } = params || {};
      console.log(`[MCP] Tool call: ${name}`, JSON.stringify(args || {}).substring(0, 200));

      try {
        let result;
        switch (name) {
          case 'test_extract_rules':
            result = await testExtractRules(args);
            break;
          case 'get_page_html':
            result = await getPageHtml(args);
            break;
          case 'get_screenshot':
            result = await getScreenshot(args);
            break;
          default:
            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: `Unknown tool: ${name}`,
                    errorCategory: 'INVALID_TOOL',
                    availableTools: ['test_extract_rules', 'get_page_html', 'get_screenshot'],
                    message: `The tool "${name}" does not exist. Available tools: test_extract_rules, get_page_html, get_screenshot`
                  }, null, 2)
                }],
                isError: true
              }
            };
        }
        return { jsonrpc: '2.0', id, result };
      } catch (error) {
        // Create detailed error response for unexpected errors
        const errorDetails = createDetailedErrorResponse(error, {
          tool: name,
          operation: 'tools/call',
          argsProvided: Object.keys(args || {})
        });

        console.error(`[MCP] Tool error in ${name}:`, JSON.stringify(errorDetails, null, 2));

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify({
                ...errorDetails,
                message: `Tool "${name}" failed: ${error.message}`,
                helpUrl: 'https://www.scrapingbee.com/documentation/',
                troubleshootingUrl: 'https://help.scrapingbee.com/en/article/what-to-do-if-my-request-fails-1jv1rmk/'
              }, null, 2)
            }],
            isError: true
          }
        };
      }
    }

    case 'notifications/initialized': {
      // Client notification that initialization is complete
      return null; // No response needed for notifications
    }

    default: {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`
        }
      };
    }
  }
}

// Test extract rules using ScrapingBee API
async function testExtractRules(args) {
  const { api_key, url, extract_rules } = args;

  if (!api_key) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: 'Missing required parameter: api_key',
          message: 'You must provide your ScrapingBee API key'
        }, null, 2)
      }],
      isError: true
    };
  }

  if (!url || !extract_rules) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: 'Missing required parameters',
          message: 'Both url and extract_rules are required'
        }, null, 2)
      }],
      isError: true
    };
  }

  // Validate extract_rules JSON
  let extractRulesObj;
  try {
    extractRulesObj = JSON.parse(extract_rules);
  } catch (e) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: `Invalid extract_rules JSON: ${e.message}`,
          message: 'The extract_rules parameter must be a valid JSON string'
        }, null, 2)
      }],
      isError: true
    };
  }

  // Validate js_scenario if provided
  if (args.js_scenario) {
    try {
      JSON.parse(args.js_scenario);
    } catch (e) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `Invalid js_scenario JSON: ${e.message}`,
            message: 'The js_scenario parameter must be a valid JSON string'
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  // Build query parameters
  const queryParams = new URLSearchParams({
    api_key,
    url,
    extract_rules
  });

  // Add optional parameters
  if (args.js_scenario) queryParams.append('js_scenario', args.js_scenario);
  if (args.render_js !== undefined) queryParams.append('render_js', args.render_js.toString());
  if (args.wait !== undefined) queryParams.append('wait', args.wait.toString());
  if (args.wait_for) queryParams.append('wait_for', args.wait_for);
  if (args.wait_browser) queryParams.append('wait_browser', args.wait_browser);
  if (args.premium_proxy !== undefined) queryParams.append('premium_proxy', args.premium_proxy.toString());
  if (args.stealth_proxy !== undefined) queryParams.append('stealth_proxy', args.stealth_proxy.toString());
  if (args.country_code) queryParams.append('country_code', args.country_code);
  if (args.session_id !== undefined) queryParams.append('session_id', args.session_id.toString());
  if (args.custom_google !== undefined) queryParams.append('custom_google', args.custom_google.toString());
  if (args.block_resources !== undefined) queryParams.append('block_resources', args.block_resources.toString());
  if (args.block_ads !== undefined) queryParams.append('block_ads', args.block_ads.toString());

  const apiUrl = `https://app.scrapingbee.com/api/v1/?${queryParams.toString()}`;

  // Track applied params for error context
  const appliedParams = {
    url,
    hasExtractRules: true,
    hasJsScenario: !!args.js_scenario,
    renderJs: args.render_js,
    wait: args.wait,
    waitFor: args.wait_for,
    premiumProxy: args.premium_proxy,
    stealthProxy: args.stealth_proxy
  };

  console.log(`[ScrapingBee] Calling API for URL: ${url}`);

  let response;
  let responseText;

  try {
    response = await fetch(apiUrl, {
      signal: AbortSignal.timeout(120000) // 2 minute timeout
    });
    responseText = await response.text();
  } catch (fetchError) {
    // Handle network-level errors with detailed context
    const errorCategory = fetchError.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK';
    const suggestions = fetchError.name === 'TimeoutError'
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

    console.error(`[ScrapingBee] Network error:`, fetchError.message);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: `Network error: ${fetchError.message}`,
          errorCategory,
          errorType: fetchError.name,
          url,
          rules_attempted: extractRulesObj,
          appliedParams,
          suggestions,
          timestamp: new Date().toISOString(),
          helpUrl: 'https://www.scrapingbee.com/documentation/'
        }, null, 2)
      }],
      isError: true
    };
  }

  try {
    if (!response.ok) {
      // Parse detailed error from ScrapingBee
      const parsedError = parseScrapingBeeError(response.status, responseText, url);

      // Extract ScrapingBee-specific headers if available
      const spbCost = response.headers.get('spb-cost');
      const spbInitialStatus = response.headers.get('spb-initial-status-code');
      const spbResolvedUrl = response.headers.get('spb-resolved-url');

      if (spbCost) parsedError.creditsCost = spbCost;
      if (spbInitialStatus) parsedError.targetSiteStatusCode = spbInitialStatus;
      if (spbResolvedUrl) parsedError.resolvedUrl = spbResolvedUrl;

      console.error(`[ScrapingBee] API error:`, JSON.stringify(parsedError, null, 2));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `ScrapingBee API error (HTTP ${response.status} ${parsedError.statusText})`,
            errorCategory: 'API_ERROR',
            scrapingBeeError: parsedError,
            url,
            rules_attempted: extractRulesObj,
            appliedParams,
            helpUrl: 'https://www.scrapingbee.com/documentation/',
            troubleshootingUrl: 'https://help.scrapingbee.com/en/article/what-to-do-if-my-request-fails-1jv1rmk/'
          }, null, 2)
        }],
        isError: true
      };
    }

    // Parse the response
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      // Response might be plain text
      data = responseText;
    }

    // Check for empty results and provide helpful feedback
    const isEmpty = checkIfEmpty(data);

    // CRITICAL: Return success: false when extraction is empty
    // This ensures the AI knows the selectors didn't work and should NOT return these rules
    if (isEmpty) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'EXTRACTION_EMPTY',
            data,
            message: 'FAILED: Extraction returned empty results. The CSS selectors do NOT match any elements on the page. You MUST NOT return these rules as working. Try: 1) Verify selectors exist in the HTML, 2) Enable render_js=true for JavaScript-heavy pages, 3) Add wait or wait_for for dynamically loaded content, 4) Use premium_proxy=true for protected sites.',
            url,
            rules_attempted: extractRulesObj,
            isEmpty: true
          }, null, 2)
        }],
        isError: true
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          data,
          message: 'Data extracted successfully',
          url,
          rules_applied: extractRulesObj,
          isEmpty: false
        }, null, 2)
      }]
    };
  } catch (error) {
    const errorDetails = createDetailedErrorResponse(error, {
      operation: 'testExtractRules',
      url,
      appliedParams
    });

    console.error(`[ScrapingBee] Unexpected error in testExtractRules:`, JSON.stringify(errorDetails, null, 2));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ...errorDetails,
          message: `Extraction failed: ${error.message}`,
          url,
          rules_attempted: extractRulesObj,
          helpUrl: 'https://www.scrapingbee.com/documentation/',
          troubleshootingUrl: 'https://help.scrapingbee.com/en/article/what-to-do-if-my-request-fails-1jv1rmk/'
        }, null, 2)
      }],
      isError: true
    };
  }
}

// Get page HTML
async function getPageHtml(args) {
  const { api_key, url } = args;

  if (!api_key || !url) {
    const missingParams = [];
    if (!api_key) missingParams.push('api_key');
    if (!url) missingParams.push('url');

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: `Missing required parameters: ${missingParams.join(', ')}`,
          errorCategory: 'VALIDATION',
          missingParams,
          providedParams: Object.keys(args || {}),
          suggestions: [
            'Provide your ScrapingBee API key as the api_key parameter',
            'Provide the target URL as the url parameter'
          ],
          timestamp: new Date().toISOString()
        }, null, 2)
      }],
      isError: true
    };
  }

  const queryParams = new URLSearchParams({ api_key, url });

  const appliedParams = {
    url,
    renderJs: args.render_js,
    wait: args.wait,
    waitFor: args.wait_for,
    premiumProxy: args.premium_proxy
  };

  if (args.render_js !== undefined) queryParams.append('render_js', args.render_js.toString());
  if (args.wait !== undefined) queryParams.append('wait', args.wait.toString());
  if (args.wait_for) queryParams.append('wait_for', args.wait_for);
  if (args.premium_proxy !== undefined) queryParams.append('premium_proxy', args.premium_proxy.toString());
  if (args.return_page_source !== undefined) queryParams.append('return_page_source', args.return_page_source.toString());

  const apiUrl = `https://app.scrapingbee.com/api/v1/?${queryParams.toString()}`;

  console.log(`[ScrapingBee] Fetching HTML for: ${url}`);

  let response;
  try {
    response = await fetch(apiUrl, {
      signal: AbortSignal.timeout(120000)
    });
  } catch (fetchError) {
    const errorCategory = fetchError.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK';

    console.error(`[ScrapingBee] Network error in getPageHtml:`, fetchError.message);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: `Network error: ${fetchError.message}`,
          errorCategory,
          errorType: fetchError.name,
          url,
          appliedParams,
          suggestions: fetchError.name === 'TimeoutError'
            ? ['Request timed out after 2 minutes', 'Try reducing wait time', 'Check if target site is responsive']
            : ['Check your internet connection', 'Verify ScrapingBee API is accessible'],
          timestamp: new Date().toISOString()
        }, null, 2)
      }],
      isError: true
    };
  }

  try {
    if (!response.ok) {
      const errorText = await response.text();
      const parsedError = parseScrapingBeeError(response.status, errorText, url);

      console.error(`[ScrapingBee] API error in getPageHtml:`, JSON.stringify(parsedError, null, 2));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `ScrapingBee API error (HTTP ${response.status} ${parsedError.statusText})`,
            errorCategory: 'API_ERROR',
            scrapingBeeError: parsedError,
            url,
            appliedParams,
            helpUrl: 'https://www.scrapingbee.com/documentation/'
          }, null, 2)
        }],
        isError: true
      };
    }

    const html = await response.text();

    // Truncate if too long (MCP has message size limits)
    const maxLength = 50000;
    const truncated = html.length > maxLength;
    const content = truncated ? html.substring(0, maxLength) + '\n\n... [TRUNCATED - HTML too large]' : html;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          html: content,
          url,
          truncated,
          originalLength: html.length
        }, null, 2)
      }]
    };
  } catch (error) {
    const errorDetails = createDetailedErrorResponse(error, {
      operation: 'getPageHtml',
      url,
      appliedParams
    });

    console.error(`[ScrapingBee] Unexpected error in getPageHtml:`, JSON.stringify(errorDetails, null, 2));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ...errorDetails,
          message: `Failed to fetch HTML: ${error.message}`,
          url,
          helpUrl: 'https://www.scrapingbee.com/documentation/'
        }, null, 2)
      }],
      isError: true
    };
  }
}

// Get screenshot
async function getScreenshot(args) {
  const { api_key, url } = args;

  if (!api_key || !url) {
    const missingParams = [];
    if (!api_key) missingParams.push('api_key');
    if (!url) missingParams.push('url');

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: `Missing required parameters: ${missingParams.join(', ')}`,
          errorCategory: 'VALIDATION',
          missingParams,
          providedParams: Object.keys(args || {}),
          suggestions: [
            'Provide your ScrapingBee API key as the api_key parameter',
            'Provide the target URL as the url parameter'
          ],
          timestamp: new Date().toISOString()
        }, null, 2)
      }],
      isError: true
    };
  }

  const queryParams = new URLSearchParams({
    api_key,
    url,
    screenshot: 'true'
  });

  const appliedParams = {
    url,
    screenshotFullPage: args.screenshot_full_page,
    windowWidth: args.window_width,
    windowHeight: args.window_height,
    wait: args.wait,
    waitFor: args.wait_for,
    premiumProxy: args.premium_proxy
  };

  if (args.screenshot_full_page !== undefined) queryParams.append('screenshot_full_page', args.screenshot_full_page.toString());
  if (args.window_width !== undefined) queryParams.append('window_width', args.window_width.toString());
  if (args.window_height !== undefined) queryParams.append('window_height', args.window_height.toString());
  if (args.wait !== undefined) queryParams.append('wait', args.wait.toString());
  if (args.wait_for) queryParams.append('wait_for', args.wait_for);
  if (args.premium_proxy !== undefined) queryParams.append('premium_proxy', args.premium_proxy.toString());

  const apiUrl = `https://app.scrapingbee.com/api/v1/?${queryParams.toString()}`;

  console.log(`[ScrapingBee] Taking screenshot of: ${url}`);

  let response;
  try {
    response = await fetch(apiUrl, {
      signal: AbortSignal.timeout(120000)
    });
  } catch (fetchError) {
    const errorCategory = fetchError.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK';

    console.error(`[ScrapingBee] Network error in getScreenshot:`, fetchError.message);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: `Network error: ${fetchError.message}`,
          errorCategory,
          errorType: fetchError.name,
          url,
          appliedParams,
          suggestions: fetchError.name === 'TimeoutError'
            ? ['Request timed out after 2 minutes', 'Screenshots can take longer - try smaller window size', 'Check if target site is responsive']
            : ['Check your internet connection', 'Verify ScrapingBee API is accessible'],
          timestamp: new Date().toISOString()
        }, null, 2)
      }],
      isError: true
    };
  }

  try {
    if (!response.ok) {
      const errorText = await response.text();
      const parsedError = parseScrapingBeeError(response.status, errorText, url);

      console.error(`[ScrapingBee] API error in getScreenshot:`, JSON.stringify(parsedError, null, 2));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `ScrapingBee API error (HTTP ${response.status} ${parsedError.statusText})`,
            errorCategory: 'API_ERROR',
            scrapingBeeError: parsedError,
            url,
            appliedParams,
            helpUrl: 'https://www.scrapingbee.com/documentation/'
          }, null, 2)
        }],
        isError: true
      };
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'Screenshot captured successfully',
          url,
          imageBase64: base64.substring(0, 1000) + '... [TRUNCATED]',
          fullBase64Length: base64.length
        }, null, 2)
      }]
    };
  } catch (error) {
    const errorDetails = createDetailedErrorResponse(error, {
      operation: 'getScreenshot',
      url,
      appliedParams
    });

    console.error(`[ScrapingBee] Unexpected error in getScreenshot:`, JSON.stringify(errorDetails, null, 2));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ...errorDetails,
          message: `Failed to capture screenshot: ${error.message}`,
          url,
          helpUrl: 'https://www.scrapingbee.com/documentation/'
        }, null, 2)
      }],
      isError: true
    };
  }
}

// Helper to check if extraction result is empty
function checkIfEmpty(data) {
  if (data === null || data === undefined) return true;
  if (typeof data === 'string' && data.trim() === '') return true;
  if (Array.isArray(data) && data.length === 0) return true;
  if (typeof data === 'object') {
    const values = Object.values(data);
    if (values.length === 0) return true;
    return values.every(v => checkIfEmpty(v));
  }
  return false;
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health check endpoint
  if (url.pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'scraping-bee-mcp', version: SERVER_INFO.version }));
    return;
  }

  // MCP endpoint (Streamable HTTP transport)
  if (url.pathname === '/mcp' && req.method === 'POST') {
    let body = '';

    req.on('data', chunk => { body += chunk; });

    req.on('end', async () => {
      try {
        const request = JSON.parse(body);
        console.log(`[MCP] Received request: ${JSON.stringify(request).substring(0, 200)}`);

        const response = await handleJsonRpcRequest(request);

        if (response === null) {
          // Notification - no response needed
          res.writeHead(202);
          res.end();
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (error) {
        console.error('[MCP] Error:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32700, message: 'Parse error' },
          id: null
        }));
      }
    });
    return;
  }

  // Legacy SSE endpoint - redirect to /mcp info
  if (url.pathname === '/sse') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'SSE transport is deprecated. Please use POST /mcp for Streamable HTTP transport.',
      documentation: 'https://modelcontextprotocol.io/specification/2025-03-26/basic/transports'
    }));
    return;
  }

  // 404 for unknown routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  ScrapingBee MCP Server v${SERVER_INFO.version}                           ║
║  Running on port ${PORT}                                         ║
╠══════════════════════════════════════════════════════════════╣
║  ENDPOINTS:                                                  ║
║  - Health:  GET  /health                                     ║
║  - MCP:     POST /mcp (Streamable HTTP transport)            ║
╠══════════════════════════════════════════════════════════════╣
║  AVAILABLE TOOLS:                                            ║
║  - test_extract_rules: Test CSS/XPath extraction             ║
║  - get_page_html: Fetch full page HTML                       ║
║  - get_screenshot: Capture page screenshot                   ║
╚══════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
