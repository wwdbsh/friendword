-- Purchase pending-confirmation UX (Slice E/F): after a RevenueCat
-- purchase the client polls for its own benefit before showing success.
-- Both benefit tables had RLS enabled with no read policy, so those
-- polls could never resolve. Owners may read their own rows; all writes
-- stay with the service-role webhook RPC.

CREATE POLICY purchase_credit_ledger_select_own ON public.purchase_credit_ledger
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY campaign_entitlements_select_owner ON public.campaign_entitlements
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM campaigns
       WHERE campaigns.id = campaign_entitlements.campaign_id
         AND campaigns.owner_user_id = auth.uid()
    )
  );
