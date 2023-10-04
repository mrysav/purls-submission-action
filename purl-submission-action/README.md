Usage:

```yaml
name: Submit PURLs

on:
  push:

permissions:
  contents: write

jobs:
  submit-purls:
    runs-on: ubuntu-latest
    steps:
      - name: Submit PURLs
        uses: hmaurer/purls-submission-action@main
        with:
          purls: |-
            pkg:npm/react@1.2.3
```
