import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { setupMockApi } from "../test/msw";
import { renderAs } from "../test/render";
import { Approvals } from "./Approvals";

setupMockApi();

async function cards() {
  await screen.findAllByRole("article");
  return screen.getAllByRole("article");
}

function valueOf(card: HTMLElement) {
  const text = within(card).getByText(/^\$[\d,]+$/).textContent ?? "$0";
  return Number(text.replace(/[$,]/g, ""));
}

describe("approval inbox role rules", () => {
  it("shows a viewer the inbox without any decision buttons", async () => {
    renderAs("vic.viewer", <Approvals />, "/approvals");
    const list = await cards();
    expect(screen.getByText(/Read only/)).toBeInTheDocument();
    expect(within(list[0]).queryByRole("button", { name: /approve|endorse/i })).not.toBeInTheDocument();
    expect(within(list[0]).getByText(/Only planners and supply managers can decide/)).toBeInTheDocument();
  });

  it("asks a planner to endorse orders above the limit and hides the quantity field", async () => {
    renderAs("pat.planner", <Approvals />, "/approvals");
    const list = await cards();
    const large = list.find((card) => valueOf(card) > 10000)!;
    const small = list.find((card) => valueOf(card) <= 10000)!;
    expect(within(large).getByText("Needs manager")).toBeInTheDocument();
    expect(within(large).getByRole("button", { name: "Endorse for manager" })).toBeEnabled();
    expect(within(small).getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(within(small).queryByLabelText("Quantity")).not.toBeInTheDocument();
  });

  it("requires a comment before rejecting", async () => {
    const user = userEvent.setup();
    renderAs("pat.planner", <Approvals />, "/approvals");
    const [first] = await cards();
    const reject = within(first).getByRole("button", { name: "Reject" });
    expect(reject).toBeDisabled();
    await user.type(within(first).getByLabelText(/Comment/), "donor stock reserved");
    expect(reject).toBeEnabled();
  });

  it("lets a planner approve a small order and reports the draft order", async () => {
    const user = userEvent.setup();
    renderAs("pat.planner", <Approvals />, "/approvals");
    const list = await cards();
    const small = list.find((card) => valueOf(card) <= 10000)!;
    await user.click(within(small).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByText(/Approved\. Draft order DPO-000001 created\./)).toBeInTheDocument());
  });

  it("gives a supply manager the quantity override", async () => {
    const user = userEvent.setup();
    renderAs("max.manager", <Approvals />, "/approvals");
    const [first] = await cards();
    const quantity = within(first).getByLabelText("Quantity");
    await user.clear(quantity);
    await user.type(quantity, "12");
    expect(within(first).getByRole("button", { name: "Approve 12" })).toBeEnabled();
    expect(within(first).getByText(/Override:/)).toBeInTheDocument();
  });
});
