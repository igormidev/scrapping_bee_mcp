#!/usr/bin/env node

import http from 'http';

const PORT = process.env.PORT || 3000;

// ScrapingBee API key (can be passed via tool arguments for flexibility)
const DEFAULT_API_KEY = process.env.SCRAPINGBEE_API_KEY || '';

// MCP Protocol version (2025-03-26 spec)
const PROTOCOL_VERSION = '2024-11-05';

// Server info
const SERVER_INFO = {
  name: 'scraping-bee-mcp',
  version: '2.0.0'
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
          description: 'JSON-encoded string describing what to extract. Examples: {"title": "h1"} for simple selector, {"items": {"selector": ".item", "type": "list", "output": {"name": ".name", "price": ".price"}}} for lists'
        },
        js_scenario: {
          type: 'string',
          description: 'Optional JSON-encoded string of scripted actions (click/type/scroll/infinite-scroll) to run before extraction'
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
      console.log(`[MCP] Tool call: ${name}`);

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
                content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                isError: true
              }
            };
        }
        return { jsonrpc: '2.0', id, result };
      } catch (error) {
        console.error(`[MCP] Tool error:`, error);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
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

  console.log(`[ScrapingBee] Calling API for URL: ${url}`);

  try {
    const response = await fetch(apiUrl);
    const responseText = await response.text();

    if (!response.ok) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `ScrapingBee API error (${response.status})`,
            details: responseText,
            url,
            rules_attempted: extractRulesObj
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
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: error.message,
          message: 'Network or API error occurred',
          url,
          rules_attempted: extractRulesObj
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
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: 'Missing required parameters: api_key and url'
        }, null, 2)
      }],
      isError: true
    };
  }

  const queryParams = new URLSearchParams({ api_key, url });

  if (args.render_js !== undefined) queryParams.append('render_js', args.render_js.toString());
  if (args.wait !== undefined) queryParams.append('wait', args.wait.toString());
  if (args.wait_for) queryParams.append('wait_for', args.wait_for);
  if (args.premium_proxy !== undefined) queryParams.append('premium_proxy', args.premium_proxy.toString());
  if (args.return_page_source !== undefined) queryParams.append('return_page_source', args.return_page_source.toString());

  const apiUrl = `https://app.scrapingbee.com/api/v1/?${queryParams.toString()}`;

  console.log(`[ScrapingBee] Fetching HTML for: ${url}`);

  try {
    const response = await fetch(apiUrl);

    if (!response.ok) {
      const errorText = await response.text();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `ScrapingBee API error (${response.status}): ${errorText}`
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
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: error.message
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
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: 'Missing required parameters: api_key and url'
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

  if (args.screenshot_full_page !== undefined) queryParams.append('screenshot_full_page', args.screenshot_full_page.toString());
  if (args.window_width !== undefined) queryParams.append('window_width', args.window_width.toString());
  if (args.window_height !== undefined) queryParams.append('window_height', args.window_height.toString());
  if (args.wait !== undefined) queryParams.append('wait', args.wait.toString());
  if (args.wait_for) queryParams.append('wait_for', args.wait_for);
  if (args.premium_proxy !== undefined) queryParams.append('premium_proxy', args.premium_proxy.toString());

  const apiUrl = `https://app.scrapingbee.com/api/v1/?${queryParams.toString()}`;

  console.log(`[ScrapingBee] Taking screenshot of: ${url}`);

  try {
    const response = await fetch(apiUrl);

    if (!response.ok) {
      const errorText = await response.text();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `ScrapingBee API error (${response.status}): ${errorText}`
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
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: error.message
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
