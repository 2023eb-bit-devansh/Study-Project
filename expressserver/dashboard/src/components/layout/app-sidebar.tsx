import { NavLink, useLocation } from "react-router-dom"
import {
  Activity,
  Database,
  GitBranch,
  LayoutGrid,
  ScrollText,
  Settings2,
  Scale,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"

const NAV = [
  {
    label: "Monitor",
    items: [
      { to: "/", icon: LayoutGrid, title: "Overview", end: true },
      { to: "/requests", icon: Activity, title: "Requests" },
    ],
  },
  {
    label: "Pipeline",
    items: [
      { to: "/tester", icon: ScrollText, title: "API Tester" },
      { to: "/trace", icon: GitBranch, title: "Trace" },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/corpus", icon: Database, title: "Corpus" },
      { to: "/config", icon: Settings2, title: "Config" },
    ],
  },
]

export function AppSidebar() {
  const { pathname } = useLocation()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="cursor-default hover:bg-transparent" asChild>
              <div>
                <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-md">
                  <Scale className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-medium">AI Fact Checker</span>
                  <span className="text-muted-foreground truncate text-xs">Law · Phase 2 PoC</span>
                </div>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = item.end
                    ? pathname === item.to
                    : pathname.startsWith(item.to)
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                        <NavLink to={item.to} end={item.end}>
                          <item.icon />
                          <span>{item.title}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
