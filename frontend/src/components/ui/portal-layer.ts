import { createContext, useContext } from "react"

export type PortalLayer = "dropdown" | "modal"

const PortalLayerContext = createContext<PortalLayer>("dropdown")

function usePortalLayer() {
  return useContext(PortalLayerContext)
}

export { PortalLayerContext, usePortalLayer }
