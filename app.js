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
        return "Du bist ein professioneller E-Commerce- und Reselling-Experte für Kleinanzeigen. Deine Aufgabe ist es, anhand der bereitgestellten Produktfotos und Metadaten eine hochkonvertierende, ehrliche und suchmaschinenoptimierte Kleinanzeige zu erstellen.\n\nMETADATEN DES USERS:\n- Zustand: " + condition + "\n- Kassenbeleg/Garantie vorhanden: " + warrantyText + "\n\nREGELN FÜR DIE PREISFINDUNG:\n1. Bei Zustand \"Neu/OVP\": Schätze den aktuellen Neupreis und setze den Verkaufspreis ca. 10-15% darunter.\n2. Bei Zustand \"Gebraucht\": Analysiere den Abnutzungsgrad. Setze einen realistischen Preis basierend auf beendeten Auktionen.\n3. Bei Zustand \"Unbekannt\": Setze einen vorsichtigen Schätzpreis (eher niedrig) und betone VB.\n\nREGELN FÜR DIE BESCHREIBUNG:\n- Schreibe freundlich, seriös und direkt.\n- Gliedere in: Kurze Einleitung, Zustand/Mängel, Lieferumfang, und technische Highlights.\n- Wenn Garantie = \"Ja\", füge zwingend hinzu: \"✅ Kassenbeleg vorhanden (Restgarantie)\"\n- Schließe mit einem Standard-Disclaimer ab (\"Der Verkauf erfolgt unter Ausschluss jeglicher Sachmängelhaftung...\").\n\nANTWORTFORMAT:\nDu MUSST exakt in folgendem JSON-Format antworten. Kein Markdown außerhalb des JSON.\n{\n  \"title\": \"Prägnanter Titel (max 65 Zeichen)\",\n  \"price\": \"Numerischer Wert oder Schätzung als Text\",\n  \"description\": \"Die vollständige, formatierte Beschreibung mit Absätzen\",\n  \"category_suggestion\": \"Empfohlene Kategorie\",\n  \"tags\": [\"tag1\", \"tag2\", \"tag3\", \"tag4\"]\n}";
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
                    { type: "image_url", image_url: { url: "data:image/jpeg;base64," + base64Image } }
                ]}
            ]
        };
        const data = await this.fetchWithRetry("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + this.keys.openai },
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
        const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + this.keys.gemini;
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

document.addEventListener('DOMContentLoaded', () => {
    const aiManager = new AIManager();
    let currentBase64Image = null;

    const aiProviderSelect = document.getElementById('ai-provider');
    const conditionSelect = document.getElementById('condition');
    const hasReceiptCheckbox = document.getElementById('has-receipt');
    const btnAnalyze = document.getElementById('btn-analyze');
    
    const outTitle = document.getElementById('out-title');
    const outPrice = document.getElementById('out-price');
    const outDesc = document.getElementById('out-desc');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    const settingsModal = document.getElementById('settings-modal');
    const btnSettings = document.getElementById('btn-settings'); 
    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnSaveKeys = document.getElementById('btn-save-keys');
    const successMsg = document.getElementById('save-success-msg');
    const inputOpenAI = document.getElementById('key-openai');
    const inputAnthropic = document.getElementById('key-anthropic');
    const inputGemini = document.getElementById('key-gemini');

    const uploadZone = document.getElementById('upload-zone');
    const imageUploadInput = document.getElementById('image-upload');
    const imagePreview = document.getElementById('image-preview');

    btnSettings.addEventListener('click', () => {
        inputOpenAI.value = localStorage.getItem('openai_key') || '';
        inputAnthropic.value = localStorage.getItem('anthropic_key') || '';
        inputGemini.value = localStorage.getItem('gemini_key') || '';
        settingsModal.classList.remove('hidden');
        successMsg.classList.add('hidden'); 
    });

    const closeModal = () => settingsModal.classList.add('hidden');
    btnCloseModal.addEventListener('click', closeModal);
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) closeModal();
    });

    btnSaveKeys.addEventListener('click', () => {
        const openaiKey = inputOpenAI.value.trim();
        const anthropicKey = inputAnthropic.value.trim();
        const geminiKey = inputGemini.value.trim();

        localStorage.setItem('openai_key', openaiKey);
        localStorage.setItem('anthropic_key', anthropicKey);
        localStorage.setItem('gemini_key', geminiKey);

        aiManager.keys.openai = openaiKey;
        aiManager.keys.anthropic = anthropicKey;
        aiManager.keys.gemini = geminiKey;

        successMsg.classList.remove('hidden');
        setTimeout(closeModal, 1500);
    });
    
    uploadZone.addEventListener('click', () => {
        imageUploadInput.click();
    });

    imageUploadInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });

    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('border-blue-500', 'bg-blue-50');
    });

    uploadZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('border-blue-500', 'bg-blue-50');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('border-blue-500', 'bg-blue-50');
        handleFiles(e.dataTransfer.files);
    });

    function handleFiles(files) {
        if (files.length === 0) return;
        
        const file = files[0];
        if (!file.type.startsWith('image/')) {
            alert('Bitte lade nur Bilder hoch!');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            imagePreview.innerHTML = '<img src="' + e.target.result + '" class="h-24 w-24 object-cover rounded-lg border shadow-sm">';
            const base64String = e.target.result.split(',')[1];
            currentBase64Image = base64String;
        };
        reader.readAsDataURL(file);
    }
    
    btnAnalyze.addEventListener('click', async () => {
        if (!currentBase64Image) {
            alert('Bitte lade zuerst ein Bild hoch!');
            return;
        }

        const provider = aiProviderSelect.value;
        
        if (provider === 'gpt-4o' && !aiManager.keys.openai) {
            alert('Bitte hinterlege deinen OpenAI API Key in den Einstellungen.');
            btnSettings.click();
            return;
        }
        if (provider === 'claude-3.5-sonnet' && !aiManager.keys.anthropic) {
            alert('Bitte hinterlege deinen Anthropic API Key in den Einstellungen.');
            btnSettings.click();
            return;
        }
        if (provider === 'gemini-2.0-flash' && !aiManager.keys.gemini) {
            alert('Bitte hinterlege deinen Gemini API Key in den Einstellungen.');
            btnSettings.click();
            return;
        }

        const condition = conditionSelect.options[conditionSelect.selectedIndex].text;
        const warranty = hasReceiptCheckbox.checked;

        loadingOverlay.classList.remove('hidden');
        loadingOverlay.classList.add('flex');
        loadingText.innerText = 'KI analysiert Bilder...';
        btnAnalyze.disabled = true;

        try {
            const result = await aiManager.generateAd(provider, currentBase64Image, condition, warranty);
            
            outTitle.value = result.title || '';
            outPrice.value = result.price || '';
            outDesc.value = result.description || '';
            
        } catch (error) {
            console.error(error);
            alert('Fehler bei der Generierung: ' + error.message);
        } finally {
            loadingOverlay.classList.add('hidden');
            loadingOverlay.classList.remove('flex');
            btnAnalyze.disabled = false;
        }
    });

    const weightSlider = document.getElementById('weight-slider');
    const weightDisplay = document.getElementById('weight-display');
    const shippingProvider = document.getElementById('shipping-provider');
    const shippingResult = document.getElementById('shipping-result');
    const shippingPrice = document.getElementById('shipping-price');

    function calculateShipping() {
        const weight = parseFloat(weightSlider.value);
        const provider = shippingProvider.value;
        
        let paketName = "";
        let price = "";
        let warning = "";

        if (provider === 'dhl') {
            if (weight <= 2) {
                paketName = "DHL Paket 2kg";
                price = "6,19 €";
            } else if (weight <= 5) {
                paketName = "DHL Paket 5kg";
                price = "7,69 €";
            } else if (weight <= 10) {
                paketName = "DHL Paket 10kg";
                price = "10,49 €";
            } else if (weight <= 20) {
                paketName = "DHL Paket 20kg";
                price = "18,99 €";
                warning = "<span class='text-red-500 text-xs ml-2 font-bold'>(Kennzeichnungspflicht!)</span>";
            } else if (weight <= 31.5) {
                paketName = "DHL Paket 31,5kg";
                price = "23,99 €";
                warning = "<span class='text-red-500 text-xs ml-2 font-bold'>(Kennzeichnungspflicht!)</span>";
            } else {
                paketName = "Gewicht zu hoch";
                price = "---";
            }
        } 
        else if (provider === 'hermes') {
            if (weight <= 25) {
                if (weight <= 5) {
                    paketName = "Hermes S-Paket (bis 50cm)";
                    price = "5,49 €";
                } else if (weight <= 10) {
                    paketName = "Hermes M-Paket (bis 80cm)";
                    price = "6,99 €";
                } else {
                    paketName = "Hermes L-Paket (bis 120cm)";
                    price = "10,99 €";
                }
            } else if (weight <= 31.5) {
                paketName = "Hermes XL-Paket (bis 150cm)";
                price = "28,99 €";
            } else {
                 paketName = "Gewicht zu hoch";
                 price = "---";
            }
        }

        shippingResult.innerHTML = "Voraussichtliches Paket: <strong>" + paketName + "</strong> " + warning;
        shippingPrice.innerHTML = price;
        
        const container = shippingResult.parentElement;
        if (weight > 10) {
            container.className = "bg-orange-50 text-orange-800 p-3 rounded-lg text-sm flex justify-between items-center transition-colors";
        } else {
            container.className = "bg-blue-50 text-blue-800 p-3 rounded-lg text-sm flex justify-between items-center transition-colors";
        }
    }

    weightSlider.addEventListener('input', (e) => {
        weightDisplay.textContent = parseFloat(e.target.value).toFixed(1).replace('.', ',');
        calculateShipping();
    });

    shippingProvider.addEventListener('change', () => {
        calculateShipping();
    });

    calculateShipping();

    const btnCopy = document.getElementById('btn-copy');

    if (btnCopy) {
        btnCopy.addEventListener('click', () => {
            const title = document.getElementById('out-title').value.trim();
            const price = document.getElementById('out-price').value.trim();
            const desc = document.getElementById('out-desc').value.trim();

            if (!title && !desc) {
                alert('Es gibt noch keinen Text zum Kopieren! Bitte generiere zuerst eine Anzeige.');
                return;
            }

            const textToCopy = title + "\nPreis: " + price + " €\n\n" + desc;

            navigator.clipboard.writeText(textToCopy).then(() => {
                const originalText = btnCopy.innerHTML;
                btnCopy.innerHTML = '<i class="fas fa-check mr-2"></i>Kopiert!';
                btnCopy.classList.replace('bg-gray-800', 'bg-green-600');
                btnCopy.classList.replace('hover:bg-gray-900', 'hover:bg-green-700');
                
                setTimeout(() => {
                    btnCopy.innerHTML = originalText;
                    btnCopy.classList.replace('bg-green-600', 'bg-gray-800');
                    btnCopy.classList.replace('hover:bg-green-700', 'hover:bg-gray-900');
                }, 2000);
            }).catch(err => {
                console.error('Fehler beim Kopieren:', err);
                alert('Dein Browser blockiert das automatische Kopieren. Bitte kopiere den Text manuell.');
            });
        });
    }
});
