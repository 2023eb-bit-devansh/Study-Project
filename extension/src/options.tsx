import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { Check, Scale } from "lucide-react"
import "./index.css"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { DEFAULT_BACKEND, getBackendUrl, setBackendUrl } from "@/lib/config"

function Options() {
  const [url, setUrl] = useState(DEFAULT_BACKEND)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void getBackendUrl().then(setUrl)
  }, [])

  return (
    <div className="bg-background text-foreground min-h-screen p-6">
      <div className="mx-auto flex max-w-lg flex-col gap-5">
        <div className="flex items-center gap-2">
          <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded">
            <Scale className="size-4" />
          </div>
          <h1 className="text-base font-medium">AI Fact Checker — Options</h1>
        </div>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="backend">Backend URL</FieldLabel>
            <Input
              id="backend"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setSaved(false)
              }}
              placeholder={DEFAULT_BACKEND}
            />
            <FieldDescription>
              Where the Express orchestration backend is running. The extension talks only to this
              address.
            </FieldDescription>
          </Field>
        </FieldGroup>

        <Button
          className="w-fit"
          onClick={async () => {
            await setBackendUrl(url)
            setSaved(true)
          }}
        >
          {saved ? <Check data-icon="inline-start" /> : null}
          {saved ? "Saved" : "Save"}
        </Button>

        <Alert>
          <AlertTitle>No API keys live here</AlertTitle>
          <AlertDescription className="text-xs">
            Anyone who installs an extension can read its code, so every provider credential stays
            on the backend. This extension stores one setting: the address above.
          </AlertDescription>
        </Alert>
      </div>
    </div>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Options />
  </StrictMode>,
)
