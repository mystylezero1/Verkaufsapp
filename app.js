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
                if (!response.ok) throw new Error(`API Fehler: ${response.status} -${await response.text()}`);
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
2. Bei
