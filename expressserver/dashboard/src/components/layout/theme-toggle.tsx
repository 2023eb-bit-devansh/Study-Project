import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={theme}
      onValueChange={(v) => v && setTheme(v as "light" | "dark" | "system")}
      variant="outline"
    >
      <ToggleGroupItem value="light" aria-label="Light theme">
        <Sun />
      </ToggleGroupItem>
      <ToggleGroupItem value="system" aria-label="System theme">
        <Monitor />
      </ToggleGroupItem>
      <ToggleGroupItem value="dark" aria-label="Dark theme">
        <Moon />
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
