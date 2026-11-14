# Video model notes

Reviewed 14 November 2026 against fal's published pages. Studio's figures are
estimates and budget reservations, not provider invoice receipts. Provider
availability, access and billing can change.

The current ledger moves the reserved estimate into the allocated-use total
when a job settles. The legacy API/export field `costObservedMicro` therefore
contains an allocated estimate, not an observed provider charge. It is retained
for compatibility; no historical data is rewritten. The actual provider
invoice is not imported into Studio.

- [MiniMax H3 Max Turbo image-to-video API](https://fal.ai/models/minimax/h3-max-turbo/image-to-video/api)
  accepts a prompt, image URL, numeric duration and 768P resolution. Studio
  offers 5, 10 and 15 seconds, uses a saved project still and disables prompt
  expansion. The provider says output can run roughly 0.7 seconds longer than
  requested. Its [pricing page](https://fal.ai/models/minimax/h3-max-turbo/image-to-video)
  lists a standard 768p rate of US$0.04 per generated second from 16 November
  2026, after the current promotion. Studio reserves one extra second at that
  standard rate: US$0.24, US$0.44 or US$0.64 respectively. This is a
  conservative estimate, not a guaranteed cap on the provider's invoice.
  The request adapter is checked with a mocked provider. No live H3 request or
  completed video has yet been verified by this change.
- [Hailuo 2.3 Standard](https://fal.ai/models/fal-ai/minimax/hailuo-2.3/standard/image-to-video)
  lists US$0.28 for six seconds and US$0.56 for ten seconds. Studio now
  reserves those separate listed amounts rather than extrapolating linearly
  from the shorter clip.

The assembler accepts individual clips up to 16 seconds and enforces a 60-second
combined limit; H3's documented potential overrun therefore fits a 15-second
request. Provider operations still need real-world verification before claiming
that every generated result can be assembled or that any paid operation worked.
