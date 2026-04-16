import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setBaseUrl } from "@workspace/api-client-react"; // <--- Import the master switch
import SetupPage from "@/pages/SetupPage";
import SessionPage from "@/pages/SessionPage";
import NotFound from "@/pages/not-found";

// This line tells every button in your app to talk to your backend!
setBaseUrl("https://my-interview-backend.onrender.com");

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={SetupPage} />
      <Route path="/session/:id" component={SessionPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;