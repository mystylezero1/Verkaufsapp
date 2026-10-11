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
                if (!response.ok) throw new Error(`API Fehler: ${response.status}`);
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
        const data = await this.fetchWithRetry("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": this.keys.anthropic,
                "anthropic-version": "2023-06-01",
                "anthropic-cors-mac-hack": "true"
            },
            body: JSON.stringify(payload)
        });
        return JSON.parse(data.content[0].text);
    }

    async callGemini(base64Image, systemPrompt) {
        if (!this.keys.gemini) throw new Error("Gemini API Key fehlt.");
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.keys.gemini}`;
        const payload = {
            system_instruction: { parts: [{ text: systemPrompt }] },
            generationConfig: { response_mime_type: "application/json" },
            contents: [{
                parts: [
                    { text: "Erstelle die Anzeige basierend auf diesem Bild." },
                    { inline_data: { mime_type: "image/jpeg", data: base64Image } }
                ]
            }]
        };
        const data = await this.fetchWithRetry(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        return JSON.parse(data.candidates[0].content.parts[0].text);
    }
}

// Hauptlogik, wenn die Seite geladen ist
document.addEventListener('DOMContentLoaded', () => {
    const aiManager = new AIManager();
    
    // --- UI Elemente Versand ---
    const weightSlider = document.getElementById('weight-slider');
    const weightDisplay = document.getElementById('weight-display');
    
    // --- UI Elemente Modal ---
    const settingsModal = document.getElementById('settings-modal');
    const btnSettings = document.getElementById('btn-settings'); 
    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnSaveKeys = document.getElementById('btn-save-keys');
    const successMsg = document.getElementById('save-success-msg');

    const inputOpenAI = document.getElementById('key-openai');
    const inputAnthropic = document.getElementById('key-anthropic');
    const inputGemini = document.getElementById('key-gemini');

    // ==========================================
    // 1. Modal & LocalStorage Logik
    // ==========================================
    
    // Modal öffnen & Keys laden
    btnSettings.addEventListener('click', () => {
        inputOpenAI.value = localStorage.getItem('openai_key') || '';
        inputAnthropic.value = localStorage.getItem('anthropic_key') || '';
        inputGemini.value = localStorage.getItem('gemini_key') || '';
        
        settingsModal.classList.remove('hidden');
        successMsg.classList.add('hidden'); 
    });

    // Modal schließen Funktion
    const closeModal = () => {
        settingsModal.classList.add('hidden');
    };

    btnCloseModal.addEventListener('click', closeModal);

    // Klick auf Hintergrund schließt das Modal
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            closeModal();
        }
    });

    // Keys im LocalStorage speichern
    btnSaveKeys.addEventListener('click', () => {
        const openaiKey = inputOpenAI.value.trim();
        const anthropicKey = inputAnthropic.value.trim();
        const geminiKey = inputGemini.value.trim();

        localStorage.setItem('openai_key', openaiKey);
        localStorage.setItem('anthropic_key', anthropicKey);
        localStorage.setItem('gemini_key', geminiKey);

        // AIManager direkt updaten
        aiManager.keys.openai = openaiKey;
        aiManager.keys.anthropic = anthropicKey;
        aiManager.keys.gemini = geminiKey;

        successMsg.classList.remove('hidden');
        setTimeout(() => {
            closeModal();
        }, 1500);
    });

    // ==========================================
    // 2. Versand-Slider Logik (Basis)
    // ==========================================
    weightSlider.addEventListener('input', (e) => {
        weightDisplay.textContent = e.target.value;
        // Zukünftig: Hier wird calculateShipping() aufgerufen
    });
});
