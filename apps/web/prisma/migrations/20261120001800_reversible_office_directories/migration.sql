ALTER TABLE "Client" ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "officeFieldHeads" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Counterparty" ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "officeFieldHeads" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "PriceItem" ADD COLUMN "officeFieldHeads" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "CashAccount" ADD COLUMN "officeFieldHeads" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ExpenseArticle" ADD COLUMN "officeFieldHeads" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "OrgSetting" ADD COLUMN "officeFieldHeads" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Project" ADD COLUMN "officeFieldHeads" JSONB NOT NULL DEFAULT '{}';

CREATE SEQUENCE "OfficeDirectoryFieldHead";
CREATE FUNCTION "pero_office_directory_field_heads"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE field_name TEXT;
BEGIN
  FOREACH field_name IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(NEW) -> field_name) IS DISTINCT FROM (to_jsonb(OLD) -> field_name)
       AND (NEW."officeFieldHeads" -> field_name) IS NOT DISTINCT FROM (OLD."officeFieldHeads" -> field_name) THEN
      NEW."officeFieldHeads" := jsonb_set(NEW."officeFieldHeads", ARRAY[field_name],
        to_jsonb(nextval('"OfficeDirectoryFieldHead"')::text));
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OfficeClientHeads" BEFORE UPDATE ON "Client" FOR EACH ROW EXECUTE FUNCTION
  "pero_office_directory_field_heads"('deletedAt','name','lastName','middleName','phone','email','address','comment','passportNumber','passportIssuedBy','isContactPerson');
CREATE TRIGGER "OfficeCounterpartyHeads" BEFORE UPDATE ON "Counterparty" FOR EACH ROW EXECUTE FUNCTION
  "pero_office_directory_field_heads"('deletedAt','type','company','phone','comment');
CREATE TRIGGER "OfficePriceHeads" BEFORE UPDATE ON "PriceItem" FOR EACH ROW EXECUTE FUNCTION
  "pero_office_directory_field_heads"('name','unit','price','category','active');
CREATE TRIGGER "OfficeCashHeads" BEFORE UPDATE ON "CashAccount" FOR EACH ROW EXECUTE FUNCTION
  "pero_office_directory_field_heads"('name','currency','comment','active');
CREATE TRIGGER "OfficeArticleHeads" BEFORE UPDATE ON "ExpenseArticle" FOR EACH ROW EXECUTE FUNCTION
  "pero_office_directory_field_heads"('code','name','comment','active');
CREATE TRIGGER "OfficeSettingHeads" BEFORE UPDATE ON "OrgSetting" FOR EACH ROW WHEN (NEW.key = 'defaultCashAccountId')
  EXECUTE FUNCTION "pero_office_directory_field_heads"('value');
CREATE TRIGGER "OfficeProjectContactHeads" BEFORE UPDATE ON "Project" FOR EACH ROW EXECUTE FUNCTION
  "pero_office_directory_field_heads"('clientId','contactPerson');
