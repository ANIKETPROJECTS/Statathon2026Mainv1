import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shield } from "lucide-react";
import NotFound from "@/pages/not-found";
import FWFConverter from "@/pages/FWFConverter";
import RiskAssessment from "@/pages/RiskAssessment";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

function AppLayout() {
  const [location, navigate] = useLocation();
  const onRisk = location.startsWith("/risk");

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-200 bg-white px-8 py-4">
        <div className="max-w-[1400px] mx-auto flex items-center gap-3">
          <button onClick={() => navigate("/")} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <img src={`${import.meta.env.BASE_URL}airavata-logo.png`} alt="Airavata logo" className="w-10 h-10 object-contain" />
            <div className="text-left">
              <span className="text-xl font-semibold text-black tracking-tight">AIRAVATA DEA</span>
              <p className="text-sm text-gray-500 leading-none mt-0.5">Convert, Anonymize &amp; Decrypt</p>
            </div>
          </button>

          <div className="flex-1" />

          <button
            onClick={() => navigate(onRisk ? "/" : "/risk-assessment")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors border ${
              onRisk
                ? "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700"
                : "border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100"
            }`}>
            <Shield className="w-4 h-4" />
            Risk Assessment
          </button>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-8 py-8">
        <Switch>
          <Route path="/" component={FWFConverter} />
          <Route path="/fwf" component={FWFConverter} />
          <Route path="/risk-assessment" component={RiskAssessment} />
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppLayout />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
