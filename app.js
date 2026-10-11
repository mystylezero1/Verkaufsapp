class AIManager {
    constructor() {
        this.keys = {
            openai: localStorage.getItem('openai_key') || '',
            anthropic: localStorage.getItem('anthropic_key') || '',
            gemini: localStorage.getItem('gemini_key') || ''
        };
    }

    async fetchWithRetry(url, options, maxRetries = 3) {
        let retries = 0;
        while (retries < maxRetries) {
            try {
                const response = await fetch(url, options);
                if (response.status === 429) {
                    const retryAfter = response.headers.get('Retry-After');
                    const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, retries) * 2000;
                    console.warn(`Rate Limit. Warte ${waitTime/1000}s...`);
                    const loadText = document.getElementById('loading-text');
                    if(loadText) loadText.innerText = `Rate Limit! Neustart in ${waitTime/1000}s...`;
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    retries++;
                    continue;
                }
                if (!response.ok) throw new Error(`API Fehler: ${response.status} - ${await response.text()}`);
                return await response.json();
            } catch (error) {
                if (retries === maxRetries - 1) throw error;
                retries++;
            }
        }
    }

    getSystemPrompt(condition, warranty) {
        const warrantyText = warranty ? 'Ja' : 'Nein';
        return `Du bist ein professioneller E-Commerce- und Reselling-Experte für Kleinanzeigen. 
Deine Aufgabe ist es, anhand der bereitgestellten Produktfotos und Metadaten eine hochkonvertierende, ehrliche und suchmaschinenoptimierte Kleinanzeige zu erstellen.

METADATEN DES USERS:
- Zustand: ${condition}
- Kassenbeleg/Garantie vorhanden: ${warrantyText}

REGELN FÜR DIE PREISFINDUNG:
1. Bei Zustand "Neu/OVP": Schätze den aktuellen Neupreis und setze den Verkaufspreis ca. 10-15% darunter.
2. Bei Zustand "Gebraucht": Analysiere den Abnutzungsgrad. Setze einen realistischen Preis basierend auf beendeten Auktionen.
3. Bei Zustand "Unbekannt": Setze einen vorsichtigen Schätzpreis (eher niedrig) und betone VB.

REGELN FÜR DIE BESCHREIBUNG:
- Schreibe freundlich, seriös und direkt.
- Gliedere in: Kurze Einleitung, Zustand/Mängel, Lieferumfang, und technische Highlights.
- Wenn Garantie = "Ja", füge zwingend hinzu: "✅ Kassenbeleg vorhanden (Restgarantie)"
- Schließe mit einem Standard-Disclaimer ab ("Der Verkauf erfolgt unter Ausschluss jeglicher Sachmängelhaftung...").

ANTWORTFORMAT:
Du MUSST exakt in folgendem JSON-Format antworten. Kein Markdown außerhalb des JSON.
{
  "title": "Prägnanter Titel (max 65 Zeichen)",
  "price": "Numerischer Wert oder Schätzung als Text",
  "description": "Die vollständige, formatierte Beschreibung mit Absätzen",
  "category_suggestion": "Empfohlene Kategorie",
  "tags": ["tag1", "tag2", "tag3", "tag4"]
}`;
    }

    async generateAd(provider, base64Image, condition, warranty) {
        const systemPrompt = this.getSystemPrompt(condition, warranty);
        
        if (provider === 'gpt-4o') return await this.callOpenAI(base64Image, systemPrompt);
        if (provider === 'claude-3.5-sonnet') return await this.callAnthropic(base64Image, systemPrompt);
        if (provider === 'gemini-2.0-flash') return await this.callGemini(base64Image, systemPrompt);
        
        throw new Error('Unbekannter Provider');
    }

    async callOpenAI(base64Image, systemPrompt) {
        if (!this.keys.openai) throw new Error("OpenAI API Key fehlt in den Einstellungen.");
        const payload = {
            model: "gpt-4o",
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: [
                    { type: "text", text: "Analysiere dieses Bild und erstelle die Anzeige." },
                    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                ]}
            ]
        };
        const data = await this.fetchWithRetry("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.keys.openai}` },
            body: JSON.stringify(payload)
        });
        return JSON.parse(data.choices[0].message.content);
    }

    async callAnthropic(base64Image, systemPrompt) {
        if (!this.keys.anthropic) throw new Error("Anthropic API Key fehlt.");
        const payload = {
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1024,
            system: systemPrompt,
            messages: [
                { role: "user", content: [
                    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64Image } },
                    { type: "text", text: "Bitte generiere die Kleinanzeige als reines JSON." }
                ]}
            ]
        };
        const data = await this.fetchWithRetry("
