
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { GroundingChunk, Museum } from "../types";

const CACHE_KEY = 'museum_radar_cache_v14';

export class GeminiService {
  private cache: Record<string, any> = {};

  constructor() {
    this.loadCache();
  }

  private getAI() {
    return new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  private loadCache() {
    const saved = sessionStorage.getItem(CACHE_KEY);
    if (saved) {
      try { this.cache = JSON.parse(saved); } catch (e) { this.cache = {}; }
    }
  }

  private async callWithTimeout<T>(promise: Promise<T>, ms: number = 30000): Promise<T> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("AI_RESPONSE_TIMEOUT")), ms)
    );
    return Promise.race([promise, timeout]);
  }

  async getCityFromCoords(lat: number, lng: number): Promise<string | null> {
    const key = `city-${lat.toFixed(2)}-${lng.toFixed(2)}`;
    if (this.cache[key]) return this.cache[key];

    try {
      const ai = this.getAI();
      const response: GenerateContentResponse = await this.callWithTimeout(ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Locatie: ${lat}, ${lng}. Geef enkel de exacte stad- of gemeentenaam. Geen extra tekst.`,
        config: { thinkingConfig: { thinkingBudget: 0 } }
      }), 5000);

      const cityName = response.text?.trim() || null;
      if (cityName) this.saveCache(key, cityName);
      return cityName;
    } catch (err) {
      return null;
    }
  }

  async findMuseumsByCity(city: string): Promise<Partial<Museum>[]> {
    const key = `city-m-${city.toLowerCase().trim()}`;
    if (this.cache[key]) return this.cache[key];

    try {
      const ai = this.getAI();
      const response: GenerateContentResponse = await this.callWithTimeout(ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Lijst EXACT 8 kunstmusea IN of DIRECT (max 15km) nabij ${city}. 
        CRITICAL RULES:
        1. LOCATIE: Museum MOET fysiek in of direct bij ${city} liggen. 
        2. AFSTAND: Geen resultaten buiten een straal van 50km van het stadscentrum.
        3. WEBSITE: Gebruik ENKEL echte officiële websites of geverifieerde Wikipedia pagina's.
        
        JSON format: name, city, lat, lng, description (NL, max 10 woorden), website, type, imageTerm, highlights (ARRAY).`,
        config: {
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                city: { type: Type.STRING },
                lat: { type: Type.NUMBER },
                lng: { type: Type.NUMBER },
                description: { type: Type.STRING },
                website: { type: Type.STRING },
                type: { type: Type.STRING },
                imageTerm: { type: Type.STRING },
                highlights: { type: Type.ARRAY, items: { type: Type.STRING } }
              },
              required: ["name", "city", "lat", "lng", "description", "website", "type", "imageTerm", "highlights"]
            }
          }
        }
      }), 25000);

      const data = JSON.parse(response.text || "[]");
      const filtered = data.filter((m: any) => 
        m.website && 
        m.website.startsWith('http') && 
        !m.website.includes('example.com')
      );
      
      if (filtered.length > 0) this.saveCache(key, filtered);
      return filtered;
    } catch (err) {
      throw err;
    }
  }

  async findNearbyMuseums(lat: number, lng: number): Promise<Partial<Museum>[]> {
    const key = `coords-m-${lat.toFixed(2)}-${lng.toFixed(2)}`;
    if (this.cache[key]) return this.cache[key];

    try {
      const ai = this.getAI();
      const response: GenerateContentResponse = await this.callWithTimeout(ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Zoek EXACT 8 kunstmusea die zich fysiek bevinden binnen een STRIKTE straal van maximaal 50km van de coördinaten ${lat}, ${lng}. 
        CRITICAL: Verifieer de afstanden handmatig voordat je ze toevoegt. Toon GEEN musea die verder dan 50km liggen.
        JSON format: name, city, lat, lng, description (NL, max 10 woorden), website, type, imageTerm, highlights (ARRAY).`,
        config: {
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                city: { type: Type.STRING },
                lat: { type: Type.NUMBER },
                lng: { type: Type.NUMBER },
                description: { type: Type.STRING },
                website: { type: Type.STRING },
                type: { type: Type.STRING },
                imageTerm: { type: Type.STRING },
                highlights: { type: Type.ARRAY, items: { type: Type.STRING } }
              },
              required: ["name", "city", "lat", "lng", "description", "website", "type", "imageTerm", "highlights"]
            }
          }
        }
      }), 25000);

      const data = JSON.parse(response.text || "[]");
      const filtered = data.filter((m: any) => m.website && m.website.startsWith('http'));
      if (filtered.length > 0) this.saveCache(key, filtered);
      return filtered;
    } catch (err) {
      throw err;
    }
  }

  async *getNearbyActivitiesStream(topic: string, locationContext: string) {
    const ai = this.getAI();
    const prompt = `TOPIC: ${topic || 'cultuur'}. LOCATIE CONTEXT: ${locationContext}. 
    Geef 6 korte tips (NL) voor activiteiten nabij de musea. 
    Blijf strikt binnen een straal van 25-50km van ${locationContext}. Verifieer locaties.`;
    
    const responseStream = await ai.models.generateContentStream({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: { 
        tools: [{ googleSearch: {} }],
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 0 }
      }
    });

    for await (const chunk of responseStream) {
      const sources = (chunk.candidates?.[0]?.groundingMetadata?.groundingChunks as GroundingChunk[]) || [];
      const validSources = sources.filter(s => (s.maps?.uri || s.web?.uri)?.startsWith('http'));
      
      yield {
        text: chunk.text || "",
        sources: validSources,
        done: false
      };
    }
  }

  async *searchMuseumInfoStream(query: string) {
    const ai = this.getAI();
    const prompt = `Beantwoord de vraag over musea of kunst feitelijk en direct (NL): ${query}. 
    Als het over een specifieke regio gaat, verifieer de geografische nauwkeurigheid.`;
    
    const responseStream = await ai.models.generateContentStream({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: { 
        tools: [{ googleSearch: {} }],
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 0 }
      }
    });

    for await (const chunk of responseStream) {
      const sources = (chunk.candidates?.[0]?.groundingMetadata?.groundingChunks as GroundingChunk[]) || [];
      const validSources = sources.filter(s => (s.maps?.uri || s.web?.uri)?.startsWith('http'));

      yield {
        text: chunk.text || "",
        sources: validSources,
        done: false
      };
    }
  }

  private saveCache(key: string, data: any) {
    this.cache[key] = data;
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(this.cache)); } catch (e) {}
  }
}

export const gemini = new GeminiService();
