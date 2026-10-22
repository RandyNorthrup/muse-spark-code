import { readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'

const architecture = z.enum(['amd64', 'arm64']).parse(process.argv[2])
const receipt = z
  .object({
    images: z
      .array(
        z.object({
          platform: z.literal(`linux/${architecture}`),
          sbom: z.record(z.string(), z.unknown()),
          provenance: z.record(z.string(), z.unknown()),
        }),
      )
      .length(1),
  })
  .parse(JSON.parse(readFileSync(`receipts/receipt-${architecture}.json`, 'utf8')))
for (const kind of ['sbom', 'provenance'])
  writeFileSync(`receipts/${kind}.json`, JSON.stringify(receipt.images[0][kind]))
