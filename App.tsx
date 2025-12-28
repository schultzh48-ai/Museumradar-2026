
import React, { useState, useCallback, useEffect } from 'react';
import Header from './components/Header';
import MuseumCard from './components/MuseumCard';
import LocationSelector from './components/LocationSelector';
import MuseumDetail from './components/MuseumDetail';
import AICurator from './components/AICurator';
import DiscoverSection from './components/DiscoverSection';
import { gemini } from './services/geminiService';
import { Museum } from './types';
import { calculateDistance } from './utils/geo';

const App: React.FC = () => {
  const [museums, setMuseums] = useState<Museum[]>([]);
  const [selectedMuseum, setSelectedMuseum] = useState<Museum | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchContext, setSearchContext] = useState<string>('Welkom bij MuseumRadar');
  const [loadingMessage, setLoadingMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchOrigin, setSearchOrigin] = useState<{ lat: number, lng: number } | undefined>(undefined);
  const [activeArea, setActiveArea] = useState<string | undefined>(undefined);
  const [needsKey, setNeedsKey] = useState(false);

  const checkKeyStatus = async () => {
    if ((window as any).aistudio) {
      const hasKey = await (window as any).aistudio.hasSelectedApiKey();
      setNeedsKey(!hasKey);
      return hasKey;
    }
    return false;
  };

  useEffect(() => {
    checkKeyStatus();
  }, []);

  const handleOpenKeySelector = async () => {
    if ((window as any).aistudio) {
      try {
        await (window as any).aistudio.openSelectKey();
        setNeedsKey(false);
        setErrorMessage(null);
      } catch (e) {
        console.error("Key selection failed", e);
      }
    }
  };

  const handleReset = () => {
    setMuseums([]);
    setSearchContext('Welkom bij MuseumRadar');
    setSearchOrigin(undefined);
    setActiveArea(undefined);
    setErrorMessage(null);
    setSelectedMuseum(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSearch = useCallback(async (searchType: 'current' | 'place', value?: string) => {
    const hasKey = await checkKeyStatus();
    if (!hasKey) return;

    setLoading(true);
    setErrorMessage(null);
    setMuseums([]); 
    setLoadingMessage(searchType === 'current' ? 'AI scant uw omgeving...' : `AI zoekt in ${value}...`);
    
    try {
      if (searchType === 'current') {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
        });

        const { latitude, longitude } = position.coords;
        const origin = { lat: latitude, lng: longitude };
        setSearchOrigin(origin);
        
        const [museumResults, detectedCity] = await Promise.all([
          gemini.findNearbyMuseums(latitude, longitude),
          gemini.getCityFromCoords(latitude, longitude)
        ]);
        
        const areaName = detectedCity || 'de buurt';
        setSearchContext(`Resultaten voor ${areaName}`);
        setActiveArea(areaName);
        renderMuseums(museumResults, origin);
      } else if (value) {
        const museumResults = await gemini.findMuseumsByCity(value);
        let origin = undefined;
        if (museumResults.length > 0 && museumResults[0].lat) {
          origin = { lat: museumResults[0].lat, lng: museumResults[0].lng! };
          setSearchOrigin(origin);
        }
        setSearchContext(`Resultaten in ${value}`);
        setActiveArea(value);
        renderMuseums(museumResults, origin);
      }
    } catch (err: any) {
      console.error("Search error:", err);
      setErrorMessage("Kon geen resultaten ophalen. Controleer uw verbinding.");
    } finally {
      setLoading(false);
    }
  }, []);

  const renderMuseums = (data: any[], origin?: {lat: number, lng: number}) => {
    if (data.length === 0) {
      setErrorMessage("Geen musea gevonden in dit gebied.");
      return;
    }

    const mappedAndFiltered = data.map((m, idx) => {
      const distance = origin && m.lat ? calculateDistance(origin.lat, origin.lng, m.lat, m.lng) : undefined;
      return {
        id: `m-${idx}-${Date.now()}`,
        name: m.name || 'Museum',
        city: m.city || '',
        country: m.country || '',
        description: m.description || '',
        imageUrl: `https://source.unsplash.com/featured/800x600?${encodeURIComponent(m.imageTerm || 'museum,art')}&sig=${idx}`,
        website: m.website || '#',
        highlightArtworks: m.highlights || [],
        distance,
        lat: m.lat,
        lng: m.lng,
        type: m.type
      };
    }).filter(m => {
      // Strikte filter op 50km
      if (m.distance !== undefined && m.distance > 50.1) {
        return false;
      }
      return true;
    });

    if (mappedAndFiltered.length === 0) {
      setErrorMessage("Er zijn geen musea gevonden binnen de straal van 50 km.");
      setMuseums([]);
    } else {
      setMuseums(mappedAndFiltered);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900 flex flex-col">
      <Header 
        hasError={!!errorMessage || needsKey} 
        onClose={handleReset} 
        onRefresh={handleReset}
      />
      
      {needsKey && (
        <div className="fixed top-24 left-6 right-6 z-[110] bg-zinc-900 text-white py-5 px-8 rounded-[2rem] shadow-2xl flex items-center justify-between max-w-4xl mx-auto reveal">
          <div className="flex items-center gap-4">
            <div className="bg-white/10 p-2.5 rounded-xl">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>
            </div>
            <p className="text-sm font-bold tracking-tight">Activeer uw AI-key voor toegang tot realtime informatie.</p>
          </div>
          <button onClick={handleOpenKeySelector} className="bg-white text-zinc-950 px-7 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-zinc-200 transition-all hover:scale-105">Activeer</button>
        </div>
      )}

      <main className="flex-grow">
        {/* Hero Section */}
        <section className="pt-48 pb-16 px-6 text-center reveal">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-4xl font-extrabold tracking-tight text-zinc-900 leading-[1.2] mb-10">
              Ontdek musea binnen <span className="text-zinc-400 italic serif font-normal">50 km</span> via GPS of zoek een stad naar keuze.
            </h2>
            <LocationSelector onSearch={handleSearch} loading={loading} disabled={needsKey} />
          </div>
        </section>

        {errorMessage && (
          <div className="max-w-4xl mx-auto px-6 mb-12 reveal">
            <div className="bg-red-50 border border-red-200 p-5 rounded-[2rem] flex justify-between items-center px-8 shadow-sm">
              <p className="text-sm font-bold text-red-600">{errorMessage}</p>
              <button onClick={() => setErrorMessage(null)} className="text-red-300 hover:text-red-500 p-2 text-xl">×</button>
            </div>
          </div>
        )}

        {/* Results Section */}
        <section className="px-6 md:px-12 max-w-7xl mx-auto pb-40">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-16 border-b border-zinc-200 pb-10">
            <div className="space-y-2">
              <h3 className="text-[11px] font-black uppercase tracking-[0.4em] text-zinc-400">{searchContext}</h3>
              <p className="text-zinc-500 text-xs font-medium">Samengesteld door onze culturele AI assistent.</p>
            </div>
            {museums.length > 0 && (
              <div className="flex items-center gap-3">
                <span className="w-2 h-2 rounded-full bg-zinc-950 animate-pulse"></span>
                <span className="text-zinc-950 text-xs font-bold uppercase tracking-widest">
                  {museums.length} Locaties gevonden
                </span>
              </div>
            )}
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
              {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                <div key={i} className="bg-white p-8 rounded-[2rem] border border-zinc-200 animate-pulse shadow-sm">
                  <div className="flex gap-2 mb-6">
                    <div className="h-4 bg-zinc-100 w-16 rounded-md"></div>
                    <div className="h-4 bg-zinc-100 w-16 rounded-md"></div>
                  </div>
                  <div className="space-y-4">
                    <div className="h-3 bg-zinc-100 w-1/3 rounded-full"></div>
                    <div className="h-8 bg-zinc-100 w-3/4 rounded-full"></div>
                    <div className="h-4 bg-zinc-100 w-full rounded-full"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : museums.length === 0 ? (
            <div className="py-32 text-center reveal bg-white/50 rounded-[4rem] border-2 border-dashed border-zinc-200 max-w-4xl mx-auto">
               <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-8 shadow-sm">
                 <svg className="w-10 h-10 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                 </svg>
               </div>
               <h4 className="text-2xl font-bold text-zinc-900 mb-3 serif">Geen actieve resultaten</h4>
               <p className="text-zinc-400 text-sm max-w-xs mx-auto leading-relaxed">Selecteer een locatie om de AI curator te activeren en musea te ontdekken.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 reveal">
              {museums.map((museum) => (
                <MuseumCard key={museum.id} museum={museum} onClick={setSelectedMuseum} />
              ))}
            </div>
          )}
        </section>

        <AICurator activeArea={activeArea} activeCoords={searchOrigin} />
        <DiscoverSection />
      </main>

      <footer className="bg-white border-t border-zinc-200 py-20 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-12">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-zinc-950 rounded-2xl flex items-center justify-center text-white font-bold text-xl">M</div>
            <h2 className="text-xl font-black tracking-tighter uppercase text-zinc-900">MuseumRadar</h2>
          </div>
          <div className="flex flex-col items-center md:items-end gap-2">
            <p className="text-zinc-400 text-[10px] font-black uppercase tracking-[0.4em]">Powered by Gemini Flash 3.0</p>
            <p className="text-zinc-300 text-[9px] uppercase tracking-widest">© 2024 Alle rechten voorbehouden</p>
          </div>
          <div className="flex gap-10">
            <a href="#" className="text-zinc-400 hover:text-zinc-900 text-[10px] font-black uppercase tracking-[0.2em] transition-all">Privacy</a>
            <a href="#" className="text-zinc-400 hover:text-zinc-900 text-[10px] font-black uppercase tracking-[0.2em] transition-all">Support</a>
          </div>
        </div>
      </footer>

      {selectedMuseum && (
        <MuseumDetail museum={selectedMuseum} origin={searchOrigin} onClose={() => setSelectedMuseum(null)} />
      )}
    </div>
  );
};

export default App;
