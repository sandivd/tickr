import { Activity, ShieldAlert, FileText, CheckCircle2 } from 'lucide-react';

export function LandingView() {
  return (
    <div className="absolute inset-0 overflow-y-auto no-scrollbar p-8 pb-64 flex flex-col">
      <div className="relative z-10 w-full max-w-4xl mx-auto flex flex-col items-center py-12 m-auto">
        {/* Header */}
        <div className="text-center mb-16 max-w-3xl">
          <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight mb-4 font-serif">
            Tickr, your intelligent <span className="italic font-serif">financial document</span> analyzer
          </h1>
          <p className="text-lg text-[#b3b3b3] font-medium">
            Automatically finds and synthesizes recent SEC filings and public disclosures.
          </p>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
          
          {/* Card 1: Documents */}
          <div className="bg-black/20 backdrop-blur-md border border-white/10 rounded-none p-6 shadow-2xl flex flex-col hover:bg-black/30 transition-colors">
            <h3 className="text-xl font-medium text-white mb-6 text-left">
              Comprehensive SEC document coverage.
            </h3>
            
            <div className="flex-1 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white"><FileText className="w-4 h-4" /></div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-white">Form 10-K & 10-Q</div>
                  <div className="text-xs text-white/60">Annual and Quarterly Reports</div>
                </div>
              </div>
              <div className="w-full h-px bg-white/10 my-1"></div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white"><Activity className="w-4 h-4" /></div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-white">Form 8-K</div>
                  <div className="text-xs text-white/60">Current / Material Events</div>
                </div>
              </div>
              <div className="w-full h-px bg-white/10 my-1"></div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white"><ShieldAlert className="w-4 h-4" /></div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-white">Forms 3, 4, 5 & 13F</div>
                  <div className="text-xs text-white/60">Insider & Institutional Holdings</div>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Analysis */}
          <div className="bg-black/20 backdrop-blur-md border border-white/10 rounded-none p-6 shadow-2xl flex flex-col hover:bg-black/30 transition-colors">
            <h3 className="text-xl font-medium text-white mb-6 text-left">
              Deep insights pulled directly from the source.
            </h3>
            
            <div className="flex-1 flex flex-col gap-4 justify-center">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#b3b3b3] shrink-0" />
                <div className="text-sm text-white/90 font-medium">Identify key takeaways and risks</div>
              </div>
              <div className="w-full h-px bg-white/10"></div>
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#b3b3b3] shrink-0" />
                <div className="text-sm text-white/90 font-medium">Extract management commentary</div>
              </div>
              <div className="w-full h-px bg-white/10"></div>
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#b3b3b3] shrink-0" />
                <div className="text-sm text-white/90 font-medium">Synthesize multiple filings into one report</div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
