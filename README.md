# Fin Insight Finder

Fin Insight Finder is a web app for extracting insights from financial documents. Upload PDFs such as earnings reports or press releases and run AI powered tools to search, analyze sentiment, detect anomalies and forecast performance.

## Features
- **Document ingestion** – upload PDFs and automatically extract text and tickers.
- **Question answering** – chat with your documents using retrieval augmented generation with source citations.
- **Sentiment analysis** – score the tone of company mentions across filings.
- **Anomaly detection** – highlight unusual metric changes between periods.
- **Forecasting & strategy** – generate price forecasts and trading ideas from mentioned tickers.

## Tech Stack
- [Vite](https://vitejs.dev/) + [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/) and [shadcn/ui](https://ui.shadcn.com/) components
- [Supabase](https://supabase.com/) for storage, edge functions and vector search
- [OpenAI](https://openai.com/) APIs for language processing

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Run the development server**
   ```bash
   npm run dev
   ```
3. **Configure environment**
   Supabase edge functions require the following variables:
   ```bash
   OPENAI_API_KEY=<your-openai-api-key>
   SUPABASE_URL=<your-supabase-url>
   SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>
   ```
   Set them in your deployment environment or a `.env` file inside `supabase/functions` when testing locally.

## Build
Create a production build of the client:
```bash
npm run build
```
Deploy the generated assets in `dist/` to your hosting provider and deploy the Supabase functions with the Supabase CLI.

---
This project was generated with Lovable and is intended for educational and experimental use.
