import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ArrowLeftRight } from "lucide-react";
import NotFound from "@/pages/not-found";
import FWFConverter from "@/pages/FWFConverter";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

function AppLayout() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-200 bg-white px-8 py-4">
        <div className="max-w-[1400px] mx-auto flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}airavata-logo.png`} alt="Airavata logo" className="w-10 h-10 object-contain" />
          <div>
            <span className="text-xl font-semibold text-black tracking-tight">AIRAVATA DEA</span>
            <p className="text-sm text-gray-500 leading-none mt-0.5">Convert, Anonymize &amp; Decrypt</p>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-8 py-8">
        <Switch>
          <Route path="/" component={FWFConverter} />
          <Route path="/fwf" component={FWFConverter} />
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
