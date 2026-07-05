import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini API if key is available
const apiKey = process.env.GEMINI_API_KEY || '';
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

export async function POST(req: NextRequest) {
  try {
    const { action, text, context, oldText, newText } = await req.json();

    if (!action) {
      return NextResponse.json({ error: 'Missing action parameter' }, { status: 400 });
    }

    // 1. Inline Autocomplete Copilot
    if (action === 'autocomplete') {
      if (!context) {
        return NextResponse.json({ completion: '' });
      }

      if (!genAI) {
        // Fallback demo mock
        const words = context.trim().split(/\s+/);
        const lastWord = words[words.length - 1]?.toLowerCase() || '';
        let mockSuggestion = ' with offline sync capabilities';
        if (lastWord === 'the') mockSuggestion = ' collaborative document editor';
        else if (lastWord === 'local') mockSuggestion = '-first architecture';
        else if (lastWord === 'conflict') mockSuggestion = ' resolution mechanism';
        
        return NextResponse.json({ 
          completion: mockSuggestion, 
          isMock: true 
        });
      }

      try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const prompt = `You are an inline text completion assistant. Given the preceding text context of a document, write the next few words or short phrase that naturally completes the current sentence or thought.
Return ONLY the completion text itself. Do NOT include markdown, quotes, backticks, or any conversational explanation. Keep it concise (1 to 10 words).
Preceding context:
"${context}"`;

        const result = await model.generateContent(prompt);
        const textResult = result.response.text().trim();
        // Remove surrounding quotes or formatting that the model might have returned
        const cleanedResult = textResult.replace(/^["'`]|["'`]$/g, '');
        return NextResponse.json({ completion: cleanedResult });
      } catch (err) {
        console.error('Gemini autocomplete failed:', err);
        return NextResponse.json({ completion: ' to explore more options', isMock: true });
      }
    }

    // 2. Document Summary / Explainer Chat
    if (action === 'summarize') {
      if (!text) {
        return NextResponse.json({ summary: 'No text content available to summarize.' });
      }

      if (!genAI) {
        return NextResponse.json({
          summary: `### Document Summary (DEMO MODE)
- This is a placeholder summary. Set your \`GEMINI_API_KEY\` in the \`.env\` file to enable real-time Gemini AI summaries!
- The document is currently stored in MongoDB.
- Local edits are persisted in your browser's IndexedDB.`,
          isMock: true
        });
      }

      try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const prompt = `Read the following document text and provide a concise, high-level summary using markdown bullet points. Underline key terms where appropriate.
Document Text:
"${text}"`;

        const result = await model.generateContent(prompt);
        return NextResponse.json({ summary: result.response.text() });
      } catch (err) {
        console.error('Gemini summary failed:', err);
        return NextResponse.json({ error: 'Gemini summary service failed' }, { status: 500 });
      }
    }

    // 3. Version Diff Explainer
    if (action === 'diff') {
      if (oldText === undefined || newText === undefined) {
        return NextResponse.json({ error: 'Missing oldText or newText for diff analysis' }, { status: 400 });
      }

      if (!genAI) {
        return NextResponse.json({
          diffExplanation: `### Visual Version Differences (DEMO MODE)
*Note: To unlock live Gemini AI analysis comparing these versions, add a \`GEMINI_API_KEY\` in your \`.env\` file.*

**Detected structural differences:**
- Old text character length: ${oldText.length}
- New text character length: ${newText.length}
- Shift size: ${newText.length - oldText.length} characters.`,
          isMock: true
        });
      }

      try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const prompt = `Compare the older version of the document with the newer version. Explain the main changes, additions, deletions, and structural reorganizations in a friendly, conversational bullet-point summary.
Old Version:
"${oldText}"

New Version:
"${newText}"`;

        const result = await model.generateContent(prompt);
        return NextResponse.json({ diffExplanation: result.response.text() });
      } catch (err) {
        console.error('Gemini diff explanation failed:', err);
        return NextResponse.json({ error: 'Gemini diff explainer failed' }, { status: 500 });
      }
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('AI copilot error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
