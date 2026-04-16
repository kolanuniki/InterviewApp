import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiProvider } from "@workspace/api-client-react"; // <--- Add this import
import SetupPage from "@/pages/SetupPage";
import SessionPage from "@/pages/SessionPage";
import NotFound from "@/pages/not-found";

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
      {/* Add the ApiProvider below and give it your backend URL */}
      <ApiProvider url="https://my-interview-backend.onrender.com">
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
}

export default App;