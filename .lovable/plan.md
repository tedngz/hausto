

# GPT-4o-mini vs Gemini 2.5 Flash: Vibe Analysis Comparison

## Objective
Run both models on the same property image and compare output quality for vibe scoring, amenity detection, and image highlights.

## Test Setup
- **Sample property**: "Eco Green Apartment for Rent" (ID: 637a444b)
- **Sample image**: `https://file4.batdongsan.com.vn/resize/1275x717/2023/11/10/20231110113154-53f7_wm.jpg`
- **Prompt**: The existing `analyze-vibe` prompt with `generateContent = true`
- **GPT-4o-mini**: Called via direct OpenAI API (current implementation, `OPENAI_API_KEY`)
- **Gemini 2.5 Flash**: Called via Lovable AI Gateway (`LOVABLE_API_KEY`)

## Execution Plan

### Step 1: Create comparison script
Write a Python script that sends the same image + prompt to both models and captures:
- Vibe scores (modern, cozy, luxurious, etc.)
- Detected amenities count and specificity
- Image highlight quality
- Detailed analysis depth
- Response time
- JSON parsing reliability

### Step 2: Run comparison
Execute the script, which will:
1. Fetch and base64-encode the sample image
2. Send identical prompts to GPT-4o-mini (OpenAI API) and Gemini 2.5 Flash (Lovable Gateway)
3. Parse and compare JSON outputs side-by-side

### Step 3: Generate report
Output a formatted comparison table to `/mnt/documents/vibe-analysis-comparison.md` covering:
- Score differences across all 10 vibe dimensions
- Amenity detection completeness
- Highlight creativity and specificity
- JSON format compliance
- Latency comparison
- Cost implications

## Technical Details
- GPT-4o-mini endpoint: `https://api.openai.com/v1/chat/completions`
- Gemini 2.5 Flash endpoint: `https://ai.gateway.lovable.dev/v1/chat/completions` (model: `google/gemini-2.5-flash`)
- Both use the same OpenAI-compatible chat completions format
- Image sent as base64 data URI in both cases

