import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import AdminLayout from "./components/AdminLayout";
import AddTools from "./pages/admin/AddTools";
import TestModel from "./pages/admin/TestModel";
import Analytics from "./pages/admin/Analytics";
import Reannotation from "./pages/admin/Reannotation";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Main application route */}
          <Route path="/" element={<Index />} />
          
          {/* Admin panel routes */}
          <Route path="/admin" element={<Navigate to="/admin/add-tools" replace />} />
          <Route path="/admin/add-tools" element={<AdminLayout><AddTools /></AdminLayout>} />
          <Route path="/admin/test-model" element={<AdminLayout><TestModel /></AdminLayout>} />
          <Route path="/admin/reannotation" element={<AdminLayout><Reannotation /></AdminLayout>} />
          <Route path="/admin/analytics" element={<AdminLayout><Analytics /></AdminLayout>} />
          
          {/* Catch-all 404 route */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
