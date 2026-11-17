import * as migration_20261101_160000_vigor_product_stones_and_sizes from './20261101_160000_vigor_product_stones_and_sizes'
import * as migration_20261117_120000_company_categories from './20261117_120000_company_categories'

export const migrations = [
  {
    up: migration_20261101_160000_vigor_product_stones_and_sizes.up,
    down: migration_20261101_160000_vigor_product_stones_and_sizes.down,
    name: '20261101_160000_vigor_product_stones_and_sizes',
  },
  {
    up: migration_20261117_120000_company_categories.up,
    down: migration_20261117_120000_company_categories.down,
    name: '20261117_120000_company_categories',
  },
]
