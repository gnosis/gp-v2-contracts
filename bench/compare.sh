#!/bin/bash

set -o pipefail
set -o errexit
set -o nounset

is_number() {
    [[ "$1" =~ ^[0-9]+$ ]]
}
gas() {
    printf '%s' "$1" | awk '{print $NF}'
}
trades() {
    printf '%s' "$1" | awk '{print $3}'
}

tested_path="$(git branch --show-current)"
tested_path="${tested_path:-HEAD}"
comparison_path="${1:-"$(git merge-base origin/main HEAD)"}"
if ! git rev-parse --verify "$comparison_path" >/dev/null; then
    echo "Invalid git reference $comparison_path" >&2
    exit 1
fi

echo "Running benchmark for $tested_path..."
yarn --silent build >/dev/null
new_bench="$(yarn --silent bench)"

git checkout --quiet "$comparison_path"

echo "Running benchmark for $comparison_path..."
yarn --silent build >/dev/null
old_bench="$(yarn --silent bench)"

paste -d '|' <(trades "$new_bench") \
             <(gas "$new_bench") \
             <(gas "$old_bench") \
             <(printf '%s' "$new_bench") |
    while IFS='|' read -r num_trades gas_new gas_old bench_line; do
        diff=""
        if is_number "$num_trades" \
            && is_number "$gas_new" \
            && is_number "$gas_old"; then
            diff=" (change: $(((gas_new - gas_old) / num_trades)) / trade)"
        fi
        printf '%s\n' "$bench_line$diff"
    done

if [[ "$tested_path" == 'HEAD' ]]; then
    git checkout --quiet "HEAD@{1}"
else
    git checkout --quiet "$tested_path"    
fi
