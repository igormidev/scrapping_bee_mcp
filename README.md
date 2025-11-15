# ScrapingBee MCP Server

A Model Context Protocol (MCP) server that provides web scraping capabilities using the ScrapingBee API. This server allows you to test and use ScrapingBee's extract rules feature to extract structured data from web pages.

## Features

- Test web scraping extract rules using CSS/XPath selectors
- Support for JavaScript rendering
- Premium and stealth proxy options
- Custom wait conditions and browser events
- Session management for consistent IP addresses
- Full ScrapingBee API parameter support

## Installation

1. Clone this repository:
```bash
git clone https://github.com/yourusername/scraping-bee-mcp.git
cd scraping-bee-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file with your ScrapingBee API key:
```bash
SCRAPINGBEE_API_KEY=your_api_key_here
```

## Usage

### With supermachine.ai

Simply provide the GitHub repository URL to supermachine.ai and it will automatically configure the MCP server.

### With Claude Desktop

Add the following to your Claude Desktop MCP settings configuration file:

**MacOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "scraping-bee": {
      "command": "node",
      "args": ["/path/to/scraping-bee-mcp/index.js"],
      "env": {
        "SCRAPINGBEE_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### With ChatGPT (via supermachine.ai)

1. Go to [supermachine.ai](https://supermachine.ai)
2. Add this GitHub repository URL
3. The MCP server will be automatically configured

## Available Tools

### test_extract_rules

Test web scraping extract rules using the ScrapingBee API.

**Parameters:**

- `url` (required): The target page URL to scrape
- `extract_rules` (required): JSON-encoded string describing what to extract (CSS/XPath selectors, lists, attributes, tables, etc.)
- `js_scenario` (optional): JSON-encoded string of scripted actions (click/type/scroll/infinite-scroll/etc.) to run before extraction
- `render_js` (optional): Enable a headless browser to execute JavaScript before extraction
- `wait` (optional): Fixed delay in milliseconds before returning the response (0-35000)
- `wait_for` (optional): CSS/XPath selector to wait for before returning
- `wait_browser` (optional): Browser event to wait for (domcontentloaded, load, networkidle0, networkidle2)
- `premium_proxy` (optional): Use residential proxy for scraper-resistant sites
- `stealth_proxy` (optional): Use stealth proxy for the hardest-to-scrape sites (most expensive option)
- `country_code` (optional): Proxy geolocation (e.g., us, de, br)
- `session_id` (optional): Keep the same IP across multiple requests (sticky sessions)
- `custom_google` (optional): Enable Google-specific handling (always true for Google domains)

**Example:**

```json
{
  "url": "https://example.com",
  "extract_rules": "{\"title\": \"h1\", \"price\": \".price\"}",
  "render_js": true
}
```

## Extract Rules Format

Extract rules are defined as a JSON object where keys are the names of the data you want to extract and values are the selectors or extraction configurations.

### Simple Extraction

```json
{
  "title": "h1",
  "price": ".product-price",
  "description": "#description"
}
```

### Advanced Extraction

```json
{
  "product_name": {
    "selector": "h1.product-title",
    "type": "text"
  },
  "all_images": {
    "selector": "img.product-image",
    "type": "list",
    "output": "@src"
  },
  "table_data": {
    "selector": "table.specs",
    "type": "table"
  }
}
```

## Development

Run the server locally:

```bash
npm start
```

## Requirements

- Node.js 18 or higher
- ScrapingBee API key (get one at [scrapingbee.com](https://www.scrapingbee.com))

## License

MIT

## Support

For issues or questions:
- ScrapingBee API documentation: https://www.scrapingbee.com/documentation/
- MCP documentation: https://modelcontextprotocol.io/
