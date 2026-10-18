// src/ui/navigation.js — Tab sections for the explorer. The selected tab determines the section,
// so the guided walkthrough can move across sections by setting the tab alone.

export const TAB_GROUPS = Object.freeze([
  {
    id: "case",
    label: "Case",
    tabs: [
      { id: "overview", label: "Overview" },
      { id: "timeline", label: "World truth" },
      { id: "alignment", label: "Alignment" },
      { id: "truth_graph", label: "Ground truth" },
      { id: "evidence", label: "Evidence" },
      { id: "metadata", label: "Metadata" },
      { id: "decision", label: "Decision" },
      { id: "outcome", label: "Outcome" },
      { id: "explanation", label: "Explanation" }
    ]
  },
  {
    id: "portfolio",
    label: "Portfolio",
    tabs: [
      { id: "portfolio", label: "Portfolio" },
      { id: "fairness", label: "Fairness" },
      { id: "investigation", label: "Investigation" },
      { id: "network", label: "Network" },
      { id: "economics", label: "Economics" },
      { id: "validation", label: "Validation" }
    ]
  },
  {
    id: "credit",
    label: "Credit lab",
    tabs: [
      { id: "dealers", label: "Dealer View" },
      { id: "funding", label: "Funding & Rates" },
      // Shown only when the active profile has the data the tab needs.
      { id: "public_record", label: "Public record", needs: "publicRecord" },
      { id: "findings", label: "Findings", needs: "publicRecord" }
    ]
  }
]);

/** Tabs of a group that the active profile can show. */
export function visibleTabs(group, profile) {
  return group.tabs.filter((t) => !t.needs || profile?.[t.needs]);
}

/** The group that contains a tab id (the first group when the id is unknown). */
export function groupOfTab(tabId) {
  return TAB_GROUPS.find((g) => g.tabs.some((t) => t.id === tabId)) ?? TAB_GROUPS[0];
}
