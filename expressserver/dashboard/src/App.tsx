import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { ThemeProvider } from "@/components/theme-provider"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { OverviewPage } from "@/pages/overview"
import { RequestsPage } from "@/pages/requests"
import { TesterPage } from "@/pages/tester"
import { TracePage } from "@/pages/trace"
import { CorpusPage } from "@/pages/corpus"
import { ConfigPage } from "@/pages/config"

export default function App() {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={200}>
        <BrowserRouter>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset className="min-w-0">
              <Routes>
                <Route path="/" element={<OverviewPage />} />
                <Route path="/requests" element={<RequestsPage />} />
                <Route path="/tester" element={<TesterPage />} />
                <Route path="/trace" element={<TracePage />} />
                <Route path="/trace/:jobId" element={<TracePage />} />
                <Route path="/corpus" element={<CorpusPage />} />
                <Route path="/config" element={<ConfigPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </SidebarInset>
          </SidebarProvider>
        </BrowserRouter>
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  )
}
